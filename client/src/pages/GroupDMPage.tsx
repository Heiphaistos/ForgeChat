import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../store/auth'
import { useGroupCall } from '../store/groupCall'
import GroupCallPanel from '../components/voice/GroupCallPanel'
import GroupMembersPanel from '../components/chat/GroupMembersPanel'
import { useWs } from '../store/ws'
import { useUnread } from '../store/unread'
import { useDraft } from '../store/chat'
import { postWithUploadProgress } from '../utils/uploadProgress'
import api, { mediaUrl } from '../api/client'
import { Users, Loader2, ChevronUp, Trash2, Pencil, Check, X, SmilePlus, Search, UserPlus, LogOut, Settings, Paperclip, ChevronLeft, Copy, Link2, CornerUpLeft, Pin, Share2, Phone, Video } from 'lucide-react'
import toast from 'react-hot-toast'
import { useMobile } from '../contexts/MobileContext'
import EmojiPicker from '../components/chat/EmojiPicker'
import MessageInput from '../components/chat/MessageInput'
import UserPopup from '../components/UserPopup'
import { useFormatDate } from '../hooks/useFormatDate'
import { renderMarkdown } from '../utils/markdown'
import LinkPreview, { extractFirstUrl } from '../components/chat/LinkPreview'
import { handleMarkdownShortcut, stripMarkdown } from '../utils/mdShortcuts'
import { isToday, isYesterday, format } from 'date-fns'
import { useT, dateLocale, t as tr } from '../i18n'
import { openMessage, openText, reopenLocked, sendErrorText, withSeal } from '../e2e/conversations'
import type { EncPayload } from '../e2e/crypto'
import { E2EBadge, useConvEncrypted } from '../e2e/E2EBadge'
import { displayAttachments, filesExtra, prepareFiles, type PreparedFiles } from '../e2e/files'
import E2EAttachment from '../e2e/E2EAttachment'
import { AvatarDecoration } from '../components/ui/ProfileDecor'
import { gifMessage, GifMessage } from '../components/chat/gif-utils'

interface GDMReaction {
  emoji: string
  count: number
  me: boolean
  users?: string[]
}

interface GDMAttachment {
  id: string
  url: string
  filename: string
  content_type: string
  size: number
}

// Position de scroll par groupe — module-level pour survivre aux démontages
// (même pattern que MessageList : restaurée au retour dans le groupe)
const savedGdmScroll = new Map<string, number>()

interface GDMMessage {
  id: string
  content: string | null
  created_at: string
  edited_at: string | null
  sender_id: string
  sender_username: string
  sender_avatar: string | null
  sender_avatar_decoration?: string | null
  reply_to?: string | null
  reply_to_username?: string | null
  reply_to_content?: string | null
  reply_to_enc?: EncPayload | null
  reply_to_client_msg_id?: string | null
  reply_to_sender_id?: string | null
  enc?: EncPayload | null
  client_msg_id?: string | null
  purged?: boolean
  e2e?: 'ok' | 'locked'
  /** Contenu déchiffré complet (fichiers chiffrés `f`). */
  e2e_body?: { f?: unknown }
  reactions?: GDMReaction[]
  attachments?: GDMAttachment[]
}

/** Déchiffre un message de groupe et l'aperçu du message auquel il répond. */
async function openGdm(groupId: string, m: GDMMessage): Promise<GDMMessage> {
  const o = await openMessage('group', groupId, m)
  if (m.reply_to_enc && m.reply_to_sender_id) {
    const text = await openText('group', groupId, m.reply_to_enc, m.reply_to_sender_id, m.reply_to_client_msg_id)
    return { ...o, reply_to_content: text ?? tr('e2e.msg.locked') }
  }
  return o
}

interface GDMMember {
  id: string
  username: string
  avatar: string | null
  status: string
}

interface GroupDM {
  id: string
  name: string
  owner_id: string
  members: GDMMember[]
  call_participants?: string[]
}

export default function GroupDMPage() {
  const t = useT()
  const { groupId } = useParams<{ groupId: string }>()
  const [searchParams] = useSearchParams()
  const highlightMsgId = searchParams.get('highlight')
  const { user } = useAuth()
  const { on } = useWs()
  const { formatShortDate } = useFormatDate()
  const resetUnread = useUnread(s => s.reset)
  const { openSidebar } = useMobile()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [showMembers, setShowMembers] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [renameInput, setRenameInput] = useState('')
  const [addMemberInput, setAddMemberInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null)
  const [replyTo, setReplyTo] = useState<{ id: string; author_username: string; content: string | null } | null>(null)
  const [showPins, setShowPins] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [emojiPickerFor, setEmojiPickerFor] = useState<string | null>(null)
  const [typingUsers, setTypingUsers] = useState<Record<string, { username: string; timer: ReturnType<typeof setTimeout> }>>({})
  const typingDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const [allMessages, setAllMessages] = useState<GDMMessage[]>([])
  const allMessagesRef = useRef(allMessages)
  allMessagesRef.current = allMessages
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [newMsgCount, setNewMsgCount] = useState(0)
  const isAtBottomRef = useRef(true)
  // Nombre de messages au rendu précédent (0 = chargement initial pas encore fait)
  const prevLen = useRef(0)
  // Pastille de date flottante affichée pendant le scroll (parité MessageList)
  const [floatingDate, setFloatingDate] = useState<string | null>(null)
  const floatingDateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (floatingDateTimer.current) clearTimeout(floatingDateTimer.current) }, [])
  // Double-tap mobile → réaction ❤️ (même geste que MessageList)
  const dblTapStart = useRef<{ x: number; y: number } | null>(null)
  const dblTapRef = useRef<{ msgId: string; time: number } | null>(null)
  // Fermer le clavier virtuel quand on scrolle verticalement la liste (mobile)
  const kbDismissRef = useRef<{ x: number; y: number } | null>(null)
  // Popup profil au clic sur un avatar (harmonisation avec les canaux)
  const [userPopup, setUserPopup] = useState<{ userId: string; x: number; y: number } | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const initialized = useRef(false)

  const { data: group } = useQuery<GroupDM>({
    queryKey: ['group-dm', groupId],
    queryFn: () => api.get(`/dms/groups/${groupId}`).then(r => r.data),
    enabled: !!groupId,
  })
  // Appel de groupe : participants connus au chargement, puis mis à jour par GROUP_CALL_UPDATE.
  const joinGroupCall = useGroupCall(s => s.join)
  const setCallActive = useGroupCall(s => s.setActive)
  useEffect(() => {
    if (group) setCallActive(group.id, group.call_participants ?? [])
  }, [group, setCallActive])

  useEffect(() => {
    if (!group?.name) return
    const prefix = document.title.match(/^\(\d+\)\s*/)?.[0] ?? ''
    document.title = `${prefix}${group.name} | ForgeChat`
    return () => {
      const p = document.title.match(/^\(\d+\)\s*/)?.[0] ?? ''
      document.title = `${p}ForgeChat`
    }
  }, [group?.name])

  // Respecter le paramètre utilisateur "aperçus de liens" (comme MessageList)
  const { data: userSettings } = useQuery<Record<string, unknown>>({
    queryKey: ['user-settings'],
    queryFn: () => api.get('/user/settings').then(r => r.data),
    staleTime: 60_000,
  })
  const linkPreviewEnabled = (userSettings?.link_preview ?? true) as boolean

  // Messages épinglés du groupe
  const { data: groupPins = [] } = useQuery<{ id: string; content: string | null; created_at: string; sender_username: string }[]>({
    queryKey: ['group-dm-pins', groupId],
    queryFn: async () => {
      const pins: (GDMMessage & { sender_id: string })[] = (await api.get(`/dms/groups/${groupId}/pins`)).data
      return Promise.all(pins.map(p => openMessage('group', groupId!, p)))
    },
    enabled: !!groupId && showPins,
  })
  const togglePin = useMutation({
    mutationFn: (msgId: string) => api.put(`/dms/groups/${groupId}/messages/${msgId}/pin`),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['group-dm-pins', groupId] })
      toast.success(res.data?.pinned ? t('dm.pinned') : t('dm.unpinned'))
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('common.error')),
  })

  const { data: initialMessages, isError: gdmError, refetch: refetchGdm } = useQuery<GDMMessage[]>({
    queryKey: ['group-dm-messages', groupId, highlightMsgId ?? null],
    queryFn: async () => {
      if (highlightMsgId) {
        try {
          const res = await api.get(`/dms/groups/${groupId}/messages?around=${highlightMsgId}&limit=50`)
          if (res.data?.length > 0) return Promise.all(res.data.map((m: GDMMessage) => openGdm(groupId!, m)))
        } catch {}
      }
      return api.get(`/dms/groups/${groupId}/messages?limit=50`).then(r => Promise.all(r.data.map((m: GDMMessage) => openGdm(groupId!, m))))
    },
    enabled: !!groupId,
    staleTime: highlightMsgId ? 0 : 30_000,
  })

  // Groupe chiffré : le serveur ne peut pas chercher, on filtre les messages déjà déchiffrés.
  const { encrypted } = useConvEncrypted('group', groupId)
  const { data: serverResults = [], isFetching: searchFetching } = useQuery<GDMMessage[]>({
    queryKey: ['group-dm-search', groupId, searchQuery],
    queryFn: () => api.get(`/dms/groups/${groupId}/messages/search?q=${encodeURIComponent(searchQuery)}`).then(r => r.data),
    enabled: !!groupId && searchQuery.trim().length >= 2 && !encrypted,
  })
  const searchResults = useMemo(() => {
    if (!encrypted) return serverResults
    const q = searchQuery.trim().toLowerCase()
    if (q.length < 2) return []
    return allMessages
      .filter(m => m.e2e !== 'locked' && (m.content ?? '').toLowerCase().includes(q))
      .map(m => ({ ...m, author_username: m.sender_username, author_avatar: m.sender_avatar }))
      .reverse()
  }, [encrypted, serverResults, searchQuery, allMessages])

  // Initialiser les messages une seule fois par groupId
  useEffect(() => {
    if (!initialMessages) return
    initialized.current = false
  }, [groupId])

  // Cleanup des timers typing au démontage
  useEffect(() => {
    return () => {
      setTypingUsers(prev => {
        Object.values(prev).forEach(e => clearTimeout(e.timer))
        return {}
      })
      if (typingDebounce.current) clearTimeout(typingDebounce.current)
    }
  }, [])

  // Divider "Nouveaux messages" : capturer les non-lus AVANT le markRead
  // ci-dessous (ordre de déclaration des effets) puis ancrer sur le premier
  // message non lu une fois la liste chargée (même logique que MessageList)
  const unreadAtOpenG = useRef(0)
  const firstUnreadIdG = useRef<string | null>(null)
  useEffect(() => {
    unreadAtOpenG.current = useUnread.getState().counts[groupId ?? ''] ?? 0
    firstUnreadIdG.current = null
  }, [groupId])
  useEffect(() => {
    if (firstUnreadIdG.current || unreadAtOpenG.current <= 0 || allMessages.length === 0) return
    const idx = Math.max(0, allMessages.length - unreadAtOpenG.current)
    firstUnreadIdG.current = allMessages[idx]?.id ?? null
  }, [allMessages.length])

  // Effacer le badge non-lu quand on ouvre le groupe (client + serveur)
  useEffect(() => {
    if (!groupId) return
    const markRead = () => {
      resetUnread(groupId)
      api.post(`/dms/groups/${groupId}/read`).catch(() => {})
    }
    markRead()
    window.addEventListener('focus', markRead)
    return () => window.removeEventListener('focus', markRead)
  }, [groupId])

  useEffect(() => {
    // Reset when highlight changes so around-messages replace the current list
    initialized.current = false
    setAllMessages([])
    setHasMore(true)
  }, [highlightMsgId])

  useEffect(() => {
    if (!initialMessages || initialized.current) return
    initialized.current = true
    setAllMessages(initialMessages)
    setHasMore(initialMessages.length >= 50)
  }, [initialMessages])

  // Écouter les nouveaux messages, suppressions et éditions via WS
  useEffect(() => {
    const offNew = on('GROUP_DM_MESSAGE', async (raw: any) => {
      if (raw.group_id !== groupId || raw.pending_attachments) return
      const d = { ...raw, message: await openGdm(groupId!, raw.message) }
      setAllMessages(prev => {
        if (prev.find(m => m.id === d.message.id)) return prev
        return [...prev, d.message]
      })
    })
    const offDelete = on('GROUP_DM_MESSAGE_DELETE', (d: any) => {
      if (d.group_id !== groupId) return
      setAllMessages(prev => prev.filter(m => m.id !== d.message_id))
    })
    const offEdit = on('GROUP_DM_MESSAGE_EDIT', async (d: any) => {
      if (d.group_id !== groupId) return
      let content = d.content
      if (d.enc) {
        const author = allMessagesRef.current.find(m => m.id === d.message_id)?.sender_id
        content = author ? await openText('group', groupId!, d.enc, author, d.client_msg_id) : null
        if (content === null) return
      }
      setAllMessages(prev => prev.map(m =>
        m.id === d.message_id
          ? { ...m, content, enc: d.enc ?? null, client_msg_id: d.client_msg_id ?? m.client_msg_id, e2e: d.enc ? 'ok' : m.e2e, edited_at: new Date().toISOString() }
          : m
      ))
    })
    // Clés reçues : les messages en attente s'ouvrent.
    const offKeys = on('E2E_KEYS', async (d: any) => {
      if (d.conv_id !== groupId) return
      const opened = await reopenLocked('group', groupId!, allMessagesRef.current)
      if (opened.size) setAllMessages(prev => prev.map(m => (opened.get(m.id) as GDMMessage | undefined) ?? m))
      queryClient.invalidateQueries({ queryKey: ['group-dm-pins', groupId] })
    })
    const offReact = on('GROUP_DM_REACTION_TOGGLE', (d: any) => {
      if (d.group_id !== groupId) return
      const isMe = d.user_id === user?.id
      setAllMessages(prev => prev.map(m => {
        if (m.id !== d.message_id) return m
        const reactions = m.reactions ?? []
        const existing = reactions.find(r => r.emoji === d.emoji)
        let updated: GDMReaction[]
        if (d.added) {
          if (existing) {
            updated = reactions.map(r => r.emoji === d.emoji
              ? { ...r, count: r.count + 1, me: r.me || isMe }
              : r)
          } else {
            updated = [...reactions, { emoji: d.emoji, count: 1, me: isMe }]
          }
        } else {
          updated = reactions
            .map(r => r.emoji === d.emoji ? { ...r, count: r.count - 1, me: isMe ? false : r.me } : r)
            .filter(r => r.count > 0)
        }
        return { ...m, reactions: updated }
      }))
    })
    const offLeave = on('GROUP_DM_MEMBER_LEAVE', (d: any) => {
      if (d.group_id !== groupId) return
      if (d.user_id === user?.id) { navigate('/'); return }
      queryClient.invalidateQueries({ queryKey: ['group-dm', groupId] })
    })
    const offAdd = on('GROUP_DM_MEMBER_ADD', (d: any) => {
      if (d.group_id !== groupId) return
      queryClient.invalidateQueries({ queryKey: ['group-dm', groupId] })
    })
    const offRemove = on('GROUP_DM_MEMBER_REMOVE', (d: any) => {
      if (d.group_id !== groupId) return
      if (d.user_id === user?.id) { navigate('/'); return }
      queryClient.invalidateQueries({ queryKey: ['group-dm', groupId] })
    })
    const offOwner = on('GROUP_DM_OWNER_UPDATE', (d: any) => {
      if (d.group_id === groupId) queryClient.invalidateQueries({ queryKey: ['group-dm', groupId] })
    })
    const offRename = on('GROUP_DM_RENAME', (d: any) => {
      if (d.group_id !== groupId) return
      queryClient.invalidateQueries({ queryKey: ['group-dm', groupId] })
    })
    const offAttach = on('GROUP_DM_ATTACHMENT_ADDED', (d: any) => {
      if (d.group_id !== groupId) return
      setAllMessages(prev => {
        if (prev.find(m => m.id === d.message_id)) {
          return prev.map(m =>
            m.id === d.message_id
              ? { ...m, attachments: [...(m.attachments ?? []), ...d.attachments] }
              : m
          )
        }
        queryClient.invalidateQueries({ queryKey: ['group-dm-messages', groupId] })
        return prev
      })
    })
    // Le serveur diffuse déjà GROUP_DM_PIN_TOGGLE à tous les membres, mais rien ne
    // l'écoutait ici -- seul l'auteur du clic (invalidation locale dans la mutation
    // togglePin) voyait le panneau épinglés se mettre à jour ; les autres membres
    // restaient figés sur l'ancien état tant qu'ils ne fermaient/rouvraient pas le
    // panneau.
    const offPin = on('GROUP_DM_PIN_TOGGLE', (d: any) => {
      if (d.group_id !== groupId) return
      queryClient.invalidateQueries({ queryKey: ['group-dm-pins', groupId] })
    })
    const offTyping = on('TYPING', (d: any) => {
      if (d.conversation_id !== groupId || d.user_id === user?.id) return
      setTypingUsers(prev => {
        const entry = prev[d.user_id]
        if (entry) clearTimeout(entry.timer)
        const timer = setTimeout(() => {
          setTypingUsers(p => {
            const { [d.user_id]: _, ...rest } = p
            return rest
          })
        }, 3000)
        return { ...prev, [d.user_id]: { username: d.username, timer } }
      })
    })
    return () => { offNew(); offDelete(); offEdit(); offKeys(); offReact(); offAttach(); offTyping(); offLeave(); offAdd(); offRemove(); offRename(); offOwner(); offPin() }
  }, [groupId, on, user?.id])

  // Tracker si l'utilisateur est en bas du scroll
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return
    const onScroll = () => {
      const threshold = 80
      const fromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
      isAtBottomRef.current = fromBottom < threshold
      if (isAtBottomRef.current) setNewMsgCount(0)
      // Mémoriser la position si on est remonté dans l'historique
      if (groupId) {
        if (fromBottom > 200) savedGdmScroll.set(groupId, container.scrollTop)
        else savedGdmScroll.delete(groupId)
      }
      // Pastille de date flottante : jour du dernier séparateur passé au-dessus
      // du haut du viewport, masquée peu après la fin du scroll
      if (prevLen.current > 0) {
        const topEdge = container.getBoundingClientRect().top + 8
        let label: string | null = null
        container.querySelectorAll<HTMLElement>('[data-date-label]').forEach(d => {
          if (d.getBoundingClientRect().top < topEdge) label = d.dataset.dateLabel ?? null
        })
        if (label) {
          setFloatingDate(label)
          if (floatingDateTimer.current) clearTimeout(floatingDateTimer.current)
          floatingDateTimer.current = setTimeout(() => setFloatingDate(null), 1200)
        }
      }
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => container.removeEventListener('scroll', onScroll)
  }, [groupId])

  // Scroll to bottom quand nouveaux messages arrivent (pas au load-more)
  useEffect(() => {
    const cur = allMessages.length
    if (cur > prevLen.current && cur - prevLen.current === 1) {
      if (isAtBottomRef.current) {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
      } else {
        setNewMsgCount(n => n + 1)
      }
    }
    prevLen.current = cur
  }, [allMessages.length])

  // Scroll to bottom au chargement initial
  useEffect(() => {
    if (allMessages.length > 0 && prevLen.current === 0) {
      if (highlightMsgId) {
        setTimeout(() => {
          const el = document.getElementById(`gdm-msg-${highlightMsgId}`)
          el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          el?.classList.add('bg-fc-accent/10')
          setTimeout(() => el?.classList.remove('bg-fc-accent/10'), 2000)
        }, 300)
      } else {
        // Position mémorisée (retour dans le groupe) sauf si des non-lus attendent
        const saved = groupId ? savedGdmScroll.get(groupId) : undefined
        if (saved != null && unreadAtOpenG.current === 0 && messagesContainerRef.current) {
          messagesContainerRef.current.scrollTop = saved
          isAtBottomRef.current = false
        } else {
          bottomRef.current?.scrollIntoView({ behavior: 'instant' })
        }
      }
    }
  }, [allMessages.length, highlightMsgId])

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || allMessages.length === 0 || !groupId) return
    setLoadingMore(true)
    const container = messagesContainerRef.current
    const prevScrollHeight = container?.scrollHeight ?? 0
    try {
      const oldest = allMessages[0]
      const res = await api.get(`/dms/groups/${groupId}/messages?before=${oldest.id}&limit=50`)
      const older: GDMMessage[] = await Promise.all(res.data.map((m: GDMMessage) => openGdm(groupId, m)))
      if (older.length < 50) setHasMore(false)
      if (older.length > 0) {
        setAllMessages(prev => {
          const ids = new Set(prev.map(m => m.id))
          return [...older.filter(m => !ids.has(m.id)), ...prev]
        })
        requestAnimationFrame(() => {
          if (container) container.scrollTop = container.scrollHeight - prevScrollHeight
        })
      } else {
        setHasMore(false)
      }
    } catch (e: any) {
      if (e?.response?.status === 404) setHasMore(false)
      else toast.error(t('gdm.loadError'))
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, hasMore, allMessages, groupId, t])

  const sendMsg = useMutation({
    mutationFn: ({ text, files, replyToId }: { text: string; files: PreparedFiles; replyToId?: string }) =>
      withSeal('group', groupId!, text, body => api.post(`/dms/groups/${groupId}/messages`, {
        ...body,
        has_attachments: files.count > 0,
        reply_to: replyToId ?? null,
      }), null, { extra: filesExtra(files) }),
    onSuccess: async (res, vars) => {
      if (vars.files.count > 0 && res.data?.id) {
        await postWithUploadProgress(`/dms/groups/${groupId}/messages/${res.data.id}/attachments`, vars.files.form, vars.files.bytes).catch(() => null)
      }
    },
    onError: (e, vars) => {
      toast.error(sendErrorText(e, t('gdm.sendError')))
      // Restaurer le texte comme brouillon pour ne pas le perdre
      if (vars.text && groupId) useDraft.getState().setDraft(groupId, vars.text)
    },
  })

  const editMsg = useMutation({
    // Même id client que le message (lié à l'AAD), ou un nouveau pour un ancien message en clair.
    mutationFn: ({ msgId, content }: { msgId: string; content: string }) =>
      withSeal('group', groupId!, content, body => api.patch(`/dms/groups/${groupId}/messages/${msgId}`, body),
        allMessages.find(m => m.id === msgId)?.client_msg_id ?? crypto.randomUUID()),
    onSuccess: () => { setEditingMsgId(null); toast.success(t('gdm.edited')) },
    onError: (e) => toast.error(sendErrorText(e, t('gdm.editError'))),
  })

  const toggleReaction = useCallback(async (msgId: string, emoji: string) => {
    try {
      await api.put(`/dms/groups/${groupId}/messages/${msgId}/reactions/${encodeURIComponent(emoji)}`)
    } catch {
      toast.error(t('gdm.reactError'))
    }
  }, [groupId, t])

  const leaveGroup = useMutation({
    mutationFn: () => api.post(`/dms/groups/${groupId}/leave`),
    onSuccess: () => { toast.success(t('gdm.left')); navigate('/') },
    onError: () => toast.error(t('gdm.leaveError')),
  })

  const renameGroup = useMutation({
    mutationFn: (name: string) => api.patch(`/dms/groups/${groupId}/rename`, { name }),
    onSuccess: (_, name) => { toast.success(t('gdm.renamed', { name })); setRenameInput(''); queryClient.invalidateQueries({ queryKey: ['group-dm', groupId] }) },
    onError: () => toast.error(t('gdm.renameError')),
  })

  const addMember = useMutation({
    mutationFn: (userId: string) => api.post(`/dms/groups/${groupId}/members`, { user_id: userId }),
    onSuccess: () => {
      toast.success(t('gdm.memberAdded'))
      setAddMemberInput('')
      queryClient.invalidateQueries({ queryKey: ['group-dm', groupId] })
      queryClient.invalidateQueries({ queryKey: ['dms'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('gdm.addError')),
  })

  const { data: userSearchResults = [] } = useQuery<{ id: string; username: string; discriminator: string }[]>({
    queryKey: ['user-search-gdm', addMemberInput],
    queryFn: () => api.get(`/users/search?q=${encodeURIComponent(addMemberInput)}`).then(r => r.data),
    enabled: addMemberInput.length >= 2,
  })

  const addableMembersSearchResults = useMemo(
    () => userSearchResults.filter(u => !group?.members.find(m => m.id === u.id)).slice(0, 5),
    [userSearchResults, group?.members]
  )

  if (!group) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-fc-accent border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="flex flex-1 overflow-hidden relative">
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Header */}
        <div className="fc-chat-header flex items-center gap-3 px-4 py-2.5 min-h-[48px] border-b border-fc-hover bg-fc-bg/30 flex-shrink-0">
          <button
            className="md:hidden min-w-[44px] min-h-[44px] flex items-center justify-center p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition flex-shrink-0"
            onClick={openSidebar}
            aria-label={t('gdm.back')}
          >
            <ChevronLeft size={20} />
          </button>
          <div className="w-8 h-8 rounded-full bg-fc-accent flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
            {group.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-white font-semibold text-sm truncate">{group.name}</h2>
            <p className="text-xs text-fc-muted">{t('explore.members.other', { n: group.members.length })}</p>
          </div>
          <E2EBadge kind="group" id={group.id} />
          <button
            onClick={() => void joinGroupCall(group.id, 'voice')}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center p-2 rounded hover:bg-fc-hover transition text-fc-muted hover:text-white"
            title={t('gdm.voiceCall')}
            aria-label={t('gdm.voiceCallLabel')}
          >
            <Phone size={18} />
          </button>
          <button
            onClick={() => void joinGroupCall(group.id, 'video')}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center p-2 rounded hover:bg-fc-hover transition text-fc-muted hover:text-white"
            title={t('gdm.videoCall')}
            aria-label={t('gdm.videoCallLabel')}
          >
            <Video size={18} />
          </button>
          <button
            onClick={() => setShowSearch(v => !v)}
            className={`min-w-[44px] min-h-[44px] flex items-center justify-center p-2 rounded hover:bg-fc-hover transition ${showSearch ? 'text-white' : 'text-fc-muted'}`}
            title={t('gdm.search')}
            aria-label={t('gdm.searchLabel')}
            aria-pressed={showSearch}
          >
            <Search size={18} />
          </button>
          <button
            onClick={() => setShowPins(v => !v)}
            className={`min-w-[44px] min-h-[44px] flex items-center justify-center p-2 rounded hover:bg-fc-hover transition ${showPins ? 'text-white' : 'text-fc-muted'}`}
            title={t('dm.pins')}
            aria-label={t('dm.pins')}
            aria-pressed={showPins}
          >
            <Pin size={18} />
          </button>
          <button
            onClick={() => setShowSettings(v => !v)}
            className={`min-w-[44px] min-h-[44px] flex items-center justify-center p-2 rounded hover:bg-fc-hover transition ${showSettings ? 'text-white' : 'text-fc-muted'}`}
            title={t('gdm.settings')}
            aria-label={t('gdm.settings')}
            aria-pressed={showSettings}
          >
            <Settings size={18} />
          </button>
          <button
            onClick={() => setShowMembers(v => !v)}
            className={`min-w-[44px] min-h-[44px] flex items-center justify-center p-2 rounded hover:bg-fc-hover transition ${showMembers ? 'text-white' : 'text-fc-muted'}`}
            title={t('gdm.showMembers')}
            aria-label={t('gdm.members')}
            aria-pressed={showMembers}
          >
            <Users size={18} />
          </button>
        </div>

        <GroupCallPanel groupId={group.id} members={group.members} />

        {/* Panneau de recherche */}
        {showSearch && (
          <div className="border-b border-fc-hover bg-fc-bg/50 px-4 py-3">
            <div className="flex gap-2 mb-2">
              <input
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') setSearchQuery(searchInput.trim()) }}
                placeholder={t('gdm.searchPh')}
                aria-label={t('gdm.searchLabel')}
                inputMode="search" autoComplete="off"
                enterKeyHint="search" autoCapitalize="none"
                className="flex-1 px-3 py-1.5 bg-fc-input rounded text-sm text-white placeholder-fc-muted outline-none focus:ring-1 focus:ring-fc-accent"
                autoFocus
              />
              <button
                onClick={() => setSearchQuery(searchInput.trim())}
                disabled={searchInput.trim().length < 2}
                aria-label={t('gdm.search')}
                className="px-3 py-1.5 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm transition disabled:opacity-40"
              >
                <Search size={14} />
              </button>
              <button onClick={() => { setShowSearch(false); setSearchQuery(''); setSearchInput('') }} aria-label={t('gdm.closeSearch')} className="p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-fc-muted hover:text-white">
                <X size={16} aria-hidden />
              </button>
            </div>
            {searchQuery.trim().length >= 2 && (
              <div className="max-h-56 overflow-y-auto overscroll-contain space-y-1">
                {searchFetching && <p className="text-xs text-fc-muted text-center py-2">{t('gdm.searching')}</p>}
                {!searchFetching && searchResults.length === 0 && (
                  <p className="text-xs text-fc-muted text-center py-2">{t('explore.noResult', { q: searchQuery })}</p>
                )}
                {searchResults.map((msg: any) => (
                  <div key={msg.id} className="bg-fc-channel rounded p-2 text-xs">
                    <div className="flex gap-1.5 items-baseline mb-0.5">
                      <span className="font-semibold text-white">{msg.author_username}</span>
                      <span className="text-fc-muted">{formatShortDate(msg.created_at)}</span>
                    </div>
                    <p className="text-fc-text">{msg.content ?? t('common.attachment')}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Panneau paramètres */}
        {showSettings && (
          <div className="border-b border-fc-hover bg-fc-bg/50 px-4 py-3 space-y-3">
            {/* Renommer */}
            <div>
              <p className="text-[10px] text-fc-muted uppercase font-semibold mb-1">{t('gdm.rename')}</p>
              <div className="flex gap-2">
                <input
                  value={renameInput}
                  onChange={e => setRenameInput(e.target.value)}
                  placeholder={group.name}
                  aria-label={t('gdm.rename')}
                  enterKeyHint="done"
                  autoCapitalize="sentences"
                  className="flex-1 px-2 py-1.5 bg-fc-input rounded text-sm text-white placeholder-fc-muted outline-none focus:ring-1 focus:ring-fc-accent"
                  maxLength={64}
                />
                <button
                  onClick={() => renameInput.trim() && renameGroup.mutate(renameInput.trim())}
                  disabled={!renameInput.trim() || renameGroup.isPending}
                  aria-label={t('gdm.rename')}
                  className="px-3 py-1.5 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm transition disabled:opacity-40"
                >
                  <Check size={14} />
                </button>
              </div>
            </div>
            {/* Ajouter membre */}
            <div>
              <p className="text-[10px] text-fc-muted uppercase font-semibold mb-1">{t('gdm.addMember')}</p>
              <div className="flex gap-2 mb-1">
                <input
                  value={addMemberInput}
                  onChange={e => setAddMemberInput(e.target.value)}
                  placeholder={t('gdm.searchUser')}
                  aria-label={t('gdm.addMember')}
                  inputMode="search" autoComplete="off"
                  enterKeyHint="search" autoCapitalize="none"
                  className="flex-1 px-2 py-1.5 bg-fc-input rounded text-sm text-white placeholder-fc-muted outline-none focus:ring-1 focus:ring-fc-accent"
                />
              </div>
              {addMemberInput.length >= 2 && userSearchResults.length > 0 && (
                <div className="space-y-1 max-h-32 overflow-y-auto overscroll-contain">
                  {addableMembersSearchResults.map(u => (
                    <div key={u.id} className="flex items-center justify-between px-2 py-1 bg-fc-channel rounded text-xs">
                      <span className="text-white">{u.username}#{u.discriminator}</span>
                      <button
                        onClick={() => { addMember.mutate(u.id); setAddMemberInput('') }}
                        aria-label={t('gdm.addName', { name: u.username })}
                        className="p-1 text-fc-accent hover:text-indigo-400"
                      >
                        <UserPlus size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* Quitter */}
            <button
              onClick={() => setShowLeaveConfirm(true)}
              className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition"
            >
              <LogOut size={13} />
              {t('gdm.leave')}
            </button>
            {showLeaveConfirm && (
              <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 px-4" onClick={() => setShowLeaveConfirm(false)}>
                <div className="bg-fc-sidebar rounded-xl shadow-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
                  <h3 className="text-lg font-bold text-white mb-2">{t('gdm.leave')}</h3>
                  <p className="text-sm text-fc-muted mb-5">
                    {t('gdm.leaveWarn')}
                    {group.owner_id === user?.id && group.members.length > 1 && t('gdm.leaveOwner')}
                  </p>
                  <div className="flex gap-3 justify-end">
                    <button onClick={() => setShowLeaveConfirm(false)} className="px-4 py-2 text-sm rounded-lg bg-fc-hover hover:bg-fc-input text-white transition">{t('common.cancel')}</button>
                    <button onClick={() => { leaveGroup.mutate(); setShowLeaveConfirm(false) }} disabled={leaveGroup.isPending} className="px-4 py-2 text-sm rounded-lg bg-red-500 hover:bg-red-600 text-white font-semibold transition disabled:opacity-50">{t('gdm.leaveShort')}</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Jump-to-present banner */}
        {highlightMsgId && (
          <div className="flex items-center justify-between gap-2 px-4 py-1.5 bg-fc-accent/10 border-b border-fc-accent/20 flex-shrink-0">
            <span className="text-xs text-fc-accent">{t('dm.context')}</span>
            <button
              onClick={() => navigate(`/dms/groups/${groupId}`)}
              className="text-xs text-fc-accent hover:underline font-medium flex-shrink-0"
            >
              {t('channel.latest')}
            </button>
          </div>
        )}

        {/* Messages */}
        <div
          ref={messagesContainerRef}
          className="flex-1 overflow-y-auto overscroll-contain px-4 py-2 space-y-3"
          onTouchStart={e => { kbDismissRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }}
          onTouchMove={e => {
            const s = kbDismissRef.current
            if (!s) return
            const dx = Math.abs(e.touches[0].clientX - s.x)
            const dy = Math.abs(e.touches[0].clientY - s.y)
            // Scroll vertical franc (pas un swipe-reply horizontal) → blur du composer
            if (dy > 24 && dy > dx * 1.5) {
              kbDismissRef.current = null
              const el = document.activeElement as HTMLElement | null
              if (el && el.tagName === 'TEXTAREA') el.blur()
            }
          }}
        >
          {/* Pastille de date flottante pendant le scroll — sticky dans le conteneur,
              h-0 + marge négative pour ne pas décaler le flux space-y-3 */}
          {floatingDate && (
            <div className="sticky top-1 z-20 h-0 -mb-3 flex justify-center pointer-events-none" aria-hidden>
              <span className="channel-fade-in px-3 py-1 rounded-full bg-fc-channel/90 border border-fc-hover shadow-lg text-[11px] font-semibold text-fc-text capitalize whitespace-nowrap backdrop-blur-sm">
                {floatingDate}
              </span>
            </div>
          )}
          {/* Échec du chargement initial : erreur honnête + retry */}
          {gdmError && allMessages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full py-16 gap-3 select-none" role="alert">
              <div className="w-16 h-16 rounded-2xl bg-red-500/15 flex items-center justify-center text-3xl" aria-hidden>⚠️</div>
              <p className="text-base font-semibold text-white">{t('gdm.loadMessagesError')}</p>
              <p className="text-sm text-fc-muted">{t('gdm.networkError')}</p>
              <button
                onClick={() => refetchGdm()}
                className="mt-1 px-4 py-2 min-h-[44px] bg-fc-accent hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition"
              >
                {t('gdm.retry')}
              </button>
            </div>
          )}
          {/* Load more */}
          {hasMore && (
            <div className="flex justify-center py-2">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="flex items-center gap-1.5 text-xs text-fc-muted hover:text-white transition disabled:opacity-50"
              >
                {loadingMore
                  ? <Loader2 size={14} className="animate-spin" />
                  : <ChevronUp size={14} />
                }
                {loadingMore ? t('common.loading') : t('gdm.loadMore')}
              </button>
            </div>
          )}

          {allMessages.map((msg, i) => {
            const isMe = msg.sender_id === user?.id
            const prev = allMessages[i - 1]
            const msgDate = new Date(msg.created_at)
            const showDateDivider = !prev || new Date(prev.created_at).toDateString() !== msgDate.toDateString()
            const dateLabel = isToday(msgDate) ? t('saved.today')
              : isYesterday(msgDate) ? t('gdm.yesterday')
              : format(msgDate, t('gdm.dateFormat'), { locale: dateLocale() })
            return (
              <div key={msg.id}>
              {showDateDivider && (
                <div className="flex items-center gap-3 my-3 px-2 select-none" role="separator" aria-label={dateLabel} data-date-label={dateLabel}>
                  <div className="flex-1 h-px bg-fc-hover/70" />
                  <span className="text-[11px] font-semibold text-fc-muted capitalize whitespace-nowrap px-2 py-0.5 rounded-full bg-fc-hover/50">
                    {dateLabel}
                  </span>
                  <div className="flex-1 h-px bg-fc-hover/70" />
                </div>
              )}
              {firstUnreadIdG.current === msg.id && (
                <div className="flex items-center gap-2 my-2 px-2 select-none" role="separator" aria-label={t('msg.newMessages')}>
                  <div className="flex-1 h-px bg-red-400/60" />
                  <span className="text-xs font-semibold text-red-400 uppercase tracking-wide whitespace-nowrap">{t('msg.newMessages')}</span>
                  <div className="flex-1 h-px bg-red-400/60" />
                </div>
              )}
              <div
                id={`gdm-msg-${msg.id}`}
                className={`flex items-start gap-2.5 group transition-colors rounded-lg ${isMe ? 'flex-row-reverse' : ''}${highlightMsgId === msg.id ? ' bg-fc-accent/10' : ''}`}
                onTouchStart={e => { dblTapStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }}
                onTouchEnd={e => {
                  const s = dblTapStart.current
                  dblTapStart.current = null
                  if (!s) return
                  const rawDx = e.changedTouches[0].clientX - s.x
                  const dx = Math.abs(rawDx)
                  const dy = Math.abs(e.changedTouches[0].clientY - s.y)
                  // Swipe vers la droite → répondre (même geste que les canaux)
                  if (rawDx > 60 && dy < 50) {
                    dblTapRef.current = null
                    if ('vibrate' in navigator) navigator.vibrate(10)
                    setReplyTo({ id: msg.id, author_username: msg.sender_username, content: msg.content })
                    return
                  }
                  if (dx > 10 || dy > 10) { dblTapRef.current = null; return }
                  const now = Date.now()
                  if (dblTapRef.current?.msgId === msg.id && now - dblTapRef.current.time < 300) {
                    dblTapRef.current = null
                    if ('vibrate' in navigator) navigator.vibrate(15)
                    toggleReaction(msg.id, '❤️')
                  } else {
                    dblTapRef.current = { msgId: msg.id, time: now }
                  }
                }}
              >
                <AvatarDecoration id={msg.sender_avatar_decoration} size={32}>
                <button
                  onClick={e => { e.stopPropagation(); setUserPopup({ userId: msg.sender_id, x: e.clientX, y: e.clientY }) }}
                  aria-label={t('gdm.profileOf', { name: msg.sender_username })}
                  className="w-8 h-8 rounded-full bg-fc-channel flex-shrink-0 flex items-center justify-center text-xs font-bold text-white overflow-hidden hover:ring-2 hover:ring-fc-accent/60 transition cursor-pointer"
                >
                  {msg.sender_avatar
                    ? <img src={mediaUrl(msg.sender_avatar)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                    : msg.sender_username.charAt(0).toUpperCase()
                  }
                </button>
                </AvatarDecoration>
                <div className={`max-w-xs ${isMe ? 'items-end' : 'items-start'} flex flex-col`}>
                  {!isMe && (
                    <span className="text-xs text-fc-muted mb-0.5 ml-1">{msg.sender_username}</span>
                  )}
                  {editingMsgId === msg.id ? (
                    <div className="flex items-end gap-1 w-full max-w-xs">
                      <input
                        value={editContent}
                        onChange={e => setEditContent(e.target.value)}
                        aria-label={t('msg.editLabel')}
                        className="flex-1 px-3 py-1.5 bg-fc-input rounded-xl text-sm text-white outline-none focus:ring-1 focus:ring-fc-accent"
                        autoFocus
                        enterKeyHint="send"
                        onKeyDown={e => {
                          if (handleMarkdownShortcut(e, editContent, setEditContent)) return
                          if (e.key === 'Escape') setEditingMsgId(null)
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            if (editContent.trim()) editMsg.mutate({ msgId: msg.id, content: editContent.trim() })
                          }
                        }}
                      />
                      <button onClick={() => editContent.trim() && editMsg.mutate({ msgId: msg.id, content: editContent.trim() })}
                        className="p-1.5 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg"
                        aria-label={t('msg.saveEdit')}
                      ><Check size={13} /></button>
                      <button onClick={() => setEditingMsgId(null)}
                        className="p-1.5 text-fc-muted hover:text-white rounded-lg"
                        aria-label={t('msg.cancel')}
                      ><X size={13} /></button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <div className="opacity-100 md:opacity-0 md:group-hover:opacity-100 flex gap-0.5 transition">
                        <div className="relative">
                          <button
                            onClick={() => setEmojiPickerFor(p => p === msg.id ? null : msg.id)}
                            className="p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-fc-muted hover:text-fc-accent rounded transition"
                            title={t('msg.react')}
                            aria-label={t('msg.addReaction')}
                          >
                            <SmilePlus size={12} aria-hidden />
                          </button>
                          {emojiPickerFor === msg.id && (
                            <div className={`absolute z-50 ${isMe ? 'right-0' : 'left-0'} bottom-7`}>
                              <EmojiPicker
                                onPick={emoji => { toggleReaction(msg.id, emoji); setEmojiPickerFor(null) }}
                                onClose={() => setEmojiPickerFor(null)}
                              />
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => setReplyTo({ id: msg.id, author_username: msg.sender_username, content: msg.content })}
                          className="p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-fc-muted hover:text-white rounded transition"
                          title={t('msg.reply')}
                          aria-label={t('msg.replyLabel')}
                        >
                          <CornerUpLeft size={12} aria-hidden />
                        </button>
                        <button
                          onClick={() => togglePin.mutate(msg.id)}
                          className="p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-fc-muted hover:text-white rounded transition"
                          title={t('gdm.pinToggle')}
                          aria-label={t('gdm.pinToggleLabel')}
                        >
                          <Pin size={12} aria-hidden />
                        </button>
                        {msg.content && (
                          <button
                            onClick={() => { navigator.clipboard.writeText(msg.content ?? '').then(() => toast.success(t('gdm.textCopied'))).catch(() => toast.error(t('gdm.copyError'))) }}
                            className="p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-fc-muted hover:text-white rounded transition"
                            title={t('msg.copyText')}
                            aria-label={t('gdm.copyTextLabel')}
                          >
                            <Copy size={12} aria-hidden />
                          </button>
                        )}
                        <button
                          onClick={() => {
                            const url = `${window.location.origin}/dms/groups/${groupId}?highlight=${msg.id}`
                            navigator.clipboard.writeText(url).then(() => toast.success(t('gdm.linkCopied'))).catch(() => toast.error(t('gdm.copyError')))
                          }}
                          className="p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-fc-muted hover:text-white rounded transition"
                          title={t('msg.copyLink')}
                          aria-label={t('msg.copyLinkLabel')}
                        >
                          <Link2 size={12} aria-hidden />
                        </button>
                        {typeof navigator.share === 'function' && (
                          <button
                            onClick={() => {
                              const url = `${window.location.origin}/dms/groups/${groupId}?highlight=${msg.id}`
                              navigator.share({
                                title: t('gdm.shareTitle'),
                                text: msg.content ? stripMarkdown(msg.content).slice(0, 200) : undefined,
                                url,
                              }).catch(() => { /* partage annulé par l'utilisateur */ })
                            }}
                            className="p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-fc-muted hover:text-white rounded transition"
                            title={t('msg.share')}
                            aria-label={t('gdm.shareLabel')}
                          >
                            <Share2 size={12} aria-hidden />
                          </button>
                        )}
                        {isMe && (<>
                          <button
                            onClick={() => { setEditingMsgId(msg.id); setEditContent(msg.content ?? '') }}
                            className="p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-fc-muted hover:text-white rounded transition"
                            title={t('msg.edit')}
                            aria-label={t('msg.editLabel')}
                          >
                            <Pencil size={12} aria-hidden />
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(msg.id)}
                            className="p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-fc-muted hover:text-red-400 rounded transition"
                            title={t('msg.delete')}
                            aria-label={t('msg.deleteLabel')}
                          >
                            <Trash2 size={12} aria-hidden />
                          </button>
                        </>)}
                      </div>
                      <div className="flex flex-col">
                        {/* Citation du message auquel on répond */}
                        {msg.reply_to && (
                          <button
                            onClick={() => {
                              const el = document.getElementById(`gdm-msg-${msg.reply_to}`)
                              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                              // Message cité hors de la fenêtre chargée → recharger autour de lui
                              else navigate(`/dms/groups/${groupId}?highlight=${msg.reply_to}`)
                            }}
                            className="flex items-center gap-1.5 mb-0.5 pl-2 border-l-2 border-fc-accent/40 text-xs text-fc-muted hover:text-white transition text-left max-w-xs"
                          >
                            <CornerUpLeft size={10} className="text-fc-accent flex-shrink-0" aria-hidden />
                            {msg.reply_to_username && <span className="font-semibold text-white/80 flex-shrink-0">{msg.reply_to_username}</span>}
                            <span className="italic truncate">
                              {msg.reply_to_content ? stripMarkdown(msg.reply_to_content).slice(0, 60) : t('channel.deleted')}
                            </span>
                          </button>
                        )}
                        {msg.content && (
                          <div className={`px-3 py-2 rounded-2xl text-sm break-words ${
                            isMe
                              ? 'bg-fc-accent text-white rounded-tr-sm'
                              : 'bg-fc-channel text-fc-text rounded-tl-sm'
                          }`}>
                            {(() => { const gif = gifMessage(msg.content); return gif ? <GifMessage url={gif.url} provider={gif.provider} /> : renderMarkdown(msg.content) })()}
                            {msg.edited_at && <span className="text-[9px] opacity-60 ml-1">{t('msg.edited')}</span>}
                          </div>
                        )}
                        {/* Aperçu de lien (1 seul, pas si pièces jointes) */}
                        {linkPreviewEnabled && msg.content && !msg.attachments?.length && (() => {
                          const url = extractFirstUrl(msg.content ?? '')
                          return url ? <LinkPreview url={url} /> : null
                        })()}
                        {msg.attachments && msg.attachments.length > 0 && (
                          <div className="flex flex-col gap-1 mt-1">
                            {displayAttachments(msg.attachments, msg.e2e_body).map(att => {
                              if (att.e2e || att.e2eLocked) return <E2EAttachment key={att.id} att={att} mediaClass="max-w-[200px] max-h-[200px] rounded-xl" />
                              const isImg = att.content_type.startsWith('image/')
                              return isImg ? (
                                <a key={att.id} href={mediaUrl(att.url)} target="_blank" rel="noopener noreferrer">
                                  <img
                                    src={mediaUrl(att.url)}
                                    alt={att.filename}
                                    loading="lazy"
                                    decoding="async"
                                    className="max-w-[200px] max-h-[200px] rounded-xl object-cover cursor-pointer hover:opacity-90 transition"
                                    style={{ opacity: 0, transition: 'opacity 0.25s ease' }}
                                    onLoad={e => { e.currentTarget.style.opacity = '1' }}
                                  />
                                </a>
                              ) : (
                                <a
                                  key={att.id}
                                  href={mediaUrl(att.url)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-2 px-3 py-2 bg-fc-channel rounded-xl text-xs text-fc-text hover:bg-fc-hover transition max-w-[200px]"
                                >
                                  <Paperclip size={12} className="flex-shrink-0 text-fc-muted" />
                                  <span className="truncate">{att.filename}</span>
                                </a>
                              )
                            })}
                          </div>
                        )}
                        {/* Réactions */}
                        {msg.reactions && msg.reactions.length > 0 && (
                          <div className={`flex flex-wrap gap-1 mt-1 ${isMe ? 'justify-end' : 'justify-start'}`}>
                            {msg.reactions.map((r: GDMReaction) => (
                              <button
                                key={r.emoji}
                                onClick={() => toggleReaction(msg.id, r.emoji)}
                                title={(r.users ?? []).join(', ')}
                                aria-label={`${r.emoji} ${t(r.count > 1 ? 'gdm.reactions.other' : 'gdm.reactions.one', { n: r.count })}${r.users?.length ? ' — ' + r.users.join(', ') : ''}`}
                                className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border transition ${
                                  r.me
                                    ? 'bg-fc-accent/20 border-fc-accent/50 text-white'
                                    : 'bg-fc-channel border-fc-hover text-fc-muted hover:border-fc-accent/50'
                                }`}
                              >
                                <span>{r.emoji}</span>
                                <span>{r.count}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  <span className="text-[10px] text-fc-muted mt-0.5 mx-1">
                    {formatShortDate(msg.created_at)}
                  </span>
                </div>
              </div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>

        {/* Bouton scroll to bottom */}
        {newMsgCount > 0 && (
          <button
            onClick={() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); setNewMsgCount(0) }}
            aria-label={t(newMsgCount > 1 ? 'gdm.newScroll.other' : 'gdm.newScroll.one', { n: newMsgCount })}
            className="absolute bottom-20 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-full bg-fc-accent text-white text-xs font-semibold shadow-lg z-30 hover:bg-fc-accent/80 transition animate-bounce-subtle"
          >
            ↓ {t(newMsgCount > 1 ? 'gdm.new.other' : 'gdm.new.one', { n: newMsgCount })}
          </button>
        )}

        {/* Typing indicator */}
        {Object.keys(typingUsers).length > 0 && (
          <div className="px-4 pb-1 text-xs text-fc-muted flex-shrink-0">
            {Object.values(typingUsers).map(u => u.username).join(', ')}
            {Object.keys(typingUsers).length === 1 ? t('gdm.typingOne') : t('gdm.typingMany')}
          </div>
        )}

        {/* Input */}
        <MessageInput
          channelId={groupId!}
          placeholder={t('gdm.placeholder', { name: group.name })}
          sending={sendMsg.isPending}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onSend={async (content, replyToId, files) => {
            const text = content?.trim() ?? ''
            if (!text && (!files || files.length === 0)) return
            setReplyTo(null)
            try {
              // Fichiers chiffrés avant l'envoi (clés dans le message chiffré).
              sendMsg.mutate({ text, files: await prepareFiles('group', groupId!, files ?? []), replyToId })
            } catch (e) {
              toast.error(sendErrorText(e, t('gdm.sendError')))
            }
          }}
          onEdit={(msgId, content) => editMsg.mutate({ msgId, content })}
        />
      </div>

      {/* Panneau des messages épinglés */}
      {showPins && (
        <div className="absolute right-0 inset-y-0 z-20 w-full md:relative md:inset-auto md:z-auto md:w-64 border-l border-fc-hover bg-fc-channel flex-shrink-0 flex flex-col panel-slide-right">
          <div className="flex items-center justify-between px-4 py-3 border-b border-fc-bg">
            <div className="flex items-center gap-2">
              <Pin size={16} className="text-fc-accent" aria-hidden />
              <span className="font-semibold text-white text-sm">{t('dm.pins')}</span>
            </div>
            <button
              onClick={() => setShowPins(false)}
              aria-label={t('dm.closePins')}
              className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-fc-muted hover:text-white rounded hover:bg-fc-hover transition"
            >
              <X size={16} aria-hidden />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain p-3 space-y-3">
            {groupPins.length === 0 && (
              <p className="text-center text-fc-muted text-sm py-8">{t('dm.noPins')}<br/>{t('gdm.noPinsHint')}</p>
            )}
            {groupPins.map(pin => (
              <div key={pin.id} className="relative group/pin bg-fc-bg/50 rounded-lg p-3 border border-fc-hover/40 hover:border-fc-hover transition">
                <button
                  onClick={() => { setShowPins(false); navigate(`/dms/groups/${groupId}?highlight=${pin.id}`) }}
                  className="text-left w-full"
                  aria-label={t('dm.goToMessageOf', { name: pin.sender_username })}
                >
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="text-xs font-semibold text-white">{pin.sender_username}</span>
                    <span className="text-[10px] text-fc-muted">{formatShortDate(pin.created_at)}</span>
                  </div>
                  <div className="text-xs text-fc-text leading-relaxed line-clamp-3">
                    {pin.content ? stripMarkdown(pin.content) : t('common.attachment')}
                  </div>
                </button>
                <button
                  onClick={() => togglePin.mutate(pin.id)}
                  className="absolute top-1.5 right-1.5 opacity-100 md:opacity-0 md:group-hover/pin:opacity-100 p-1.5 text-fc-muted hover:text-fc-red rounded transition"
                  title={t('dm.unpin')}
                  aria-label={t('gdm.unpinLabel')}
                >
                  <X size={12} aria-hidden />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Panneau membres */}
      {showMembers && (
        <GroupMembersPanel groupId={group.id} ownerId={group.owner_id} members={group.members} meId={user?.id} />
      )}

      {/* Modale confirmation suppression */}
      {deleteConfirmId && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[300] px-4" onClick={() => setDeleteConfirmId(null)}>
          <div className="bg-fc-channel rounded-xl shadow-2xl w-full max-w-[440px] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-fc-hover">
              <h3 className="text-white font-semibold">{t('msg.deleteTitle')}</h3>
            </div>
            <div className="px-5 py-4">
              <p className="text-fc-text text-sm">{t('msg.deleteConfirm')}</p>
            </div>
            <div className="px-5 pb-4 flex justify-end gap-3">
              <button onClick={() => setDeleteConfirmId(null)} className="px-4 py-2 rounded text-sm text-fc-text hover:text-white hover:bg-fc-hover transition">
                {t('common.cancel')}
              </button>
              <button
                onClick={() => {
                  api.delete(`/dms/groups/${groupId}/messages/${deleteConfirmId}`).catch(() => toast.error(t('gdm.deleteError')))
                  setDeleteConfirmId(null)
                }}
                className="px-4 py-2 rounded text-sm font-medium bg-fc-red hover:bg-red-500 text-white transition"
              >
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Popup profil utilisateur */}
      {userPopup && (
        <UserPopup
          userId={userPopup.userId}
          anchorX={userPopup.x}
          anchorY={userPopup.y}
          onClose={() => setUserPopup(null)}
        />
      )}
    </div>
  )
}
