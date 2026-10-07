import { useEffect, useState, useCallback, useRef, useContext, useMemo } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Hash, Users, Bell, Pin, Search, Volume2, Video, Megaphone, MessagesSquare, Images, Radio, Loader2, Timer, Columns2, X, ChevronLeft, ArrowLeftRight, Lock } from 'lucide-react'
import { SplitContext } from '../contexts/SplitContext'
import NsfwGate, { useNsfwOk } from '../components/chat/NsfwGate'
import { useMobile } from '../contexts/MobileContext'
import ExportConversationButton from '../components/chat/ExportConversationButton'
import api from '../api/client'
import { useChat, useDraft, type ChatMessage } from '../store/chat'
import { postWithUploadProgress } from '../utils/uploadProgress'
import { useShallow } from 'zustand/react/shallow'
import { useWs } from '../store/ws'
import { useAuth } from '../store/auth'
import type { FileWithTtl } from '../components/chat/MessageInput'
import MessageList from '../components/chat/MessageList'
import MessageInput, { ReplyTarget } from '../components/chat/MessageInput'
import { useUnread } from '../store/unread'
import MemberList from '../components/chat/MemberList'
import PinnedPanel from '../components/chat/PinnedPanel'
import SearchPanel from '../components/chat/SearchPanel'
import VoiceVideoPage from './VoiceVideoPage'
import StageChannel from '../components/voice/StageChannel'
import ForumPage from './ForumPage'
import ThreadPanel from '../components/chat/ThreadPanel'
import ThreadSidebar from '../components/chat/ThreadSidebar'
import WelcomeScreen from '../components/chat/WelcomeScreen'
import VerificationGateModal from '../components/modals/VerificationGateModal'
import FollowChannelModal from '../components/modals/FollowChannelModal'
import OnboardingModal from '../components/modals/OnboardingModal'
import KanbanBoard from '../components/tasks/KanbanBoard'
import toast from 'react-hot-toast'
import { useT, intlLocale } from '../i18n'
import ChannelNotifModal from '../components/modals/ChannelNotifModal'
import { completeChannelKeys, openBody, openMessage, openMessages, reopenLocked } from '../e2e/conversations'
import { channelSendError, editMessage, postMessage, useChannelEncrypted } from '../e2e/channels'
import { ChannelLock } from '../e2e/ChannelBadge'
import { ServerKeyPrompt, ServerReencrypt } from '../e2e/ServerKeySettings'
import { LockdownBanner } from '../components/community/LockdownBanner'
import { filesExtra, prepareFiles, type PreparedFiles } from '../e2e/files'
import DisappearingControl from '../components/chat/DisappearingControl'
import { ThreadCountsContext } from '../components/chat/threadCounts'
import { rememberConvName } from '../e2e/searchIndex'
import { isQueued } from '../lib/offline'

function channelIcon(type: string, size = 18) {
  const cls = `flex-shrink-0`
  switch (type) {
    case 'voice': return <Volume2 size={size} className={cls} />
    case 'video': return <Video size={size} className={cls} />
    case 'announcement': return <Megaphone size={size} className={cls} />
    case 'forum': return <MessagesSquare size={size} className={cls} />
    case 'media': return <Images size={size} className={cls} />
    case 'stage': return <Radio size={size} className={cls} />
    default: return <Hash size={size} className={cls} />
  }
}

interface Props {
  forcedChannelId?: string
  isSplit?: boolean
  onClose?: () => void
}

export default function ChannelPage({ forcedChannelId, isSplit, onClose }: Props) {
  const params = useParams<{ serverId?: string; channelId?: string }>()
  const t = useT()
  const serverId = params.serverId
  const channelId = forcedChannelId ?? params.channelId
  // Salons 18+ : confirmation d'âge une fois par salon et par appareil (avant tout retour anticipé).
  const [nsfwOk, confirmerNsfw] = useNsfwOk(channelId)

  const { setSplitChannelId } = useContext(SplitContext)
  const { openSidebar } = useMobile()
  const [searchParams] = useSearchParams()
  const nav = useNavigate()
  const highlightMessageId = searchParams.get('highlight')
  const { addMessages, addMessage, updateMessage, deleteMessage, mergeAttachments, addReaction, removeReaction, setTyping, clearTyping, clearChannel } = useChat()
  const typingUsers = useChat(useShallow(s => Object.values(s.typing[channelId ?? ''] ?? {})))
  // Recherche dans un salon chiffré : sur les messages déjà chargés et déchiffrés.
  const loadedMessages = useChat(s => s.messagesByChannel[channelId ?? ''])
  const { on, onOpen, subscribeChannel } = useWs()
  const meId = useAuth(s => s.user?.id)
  const markRead = useUnread(s => s.markRead)
  const qc = useQueryClient()
  const [showMembers, setShowMembers] = useState(() => window.innerWidth >= 768)
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [activeDirectThreadId, setActiveDirectThreadId] = useState<string | null>(null)
  // Lien ?thread=<id> (notification de fil) : ouvre ce fil directement
  const threadParam = searchParams.get('thread')
  useEffect(() => {
    if (threadParam) { setActiveThreadId(null); setActiveDirectThreadId(threadParam) }
  }, [threadParam, channelId])
  const [showThreadSidebar, setShowThreadSidebar] = useState(false)
  const [showPinned, setShowPinned] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null)
  const [hasMore, setHasMore] = useState(true)
  // Onglet actif mémorisé par canal (durée de vie de l'onglet navigateur)
  const [activeTab, setActiveTabState] = useState<'Messages' | 'Tâches'>(
    () => sessionStorage.getItem(`fc_tab:${channelId}`) === 'Tâches' ? 'Tâches' : 'Messages'
  )
  const setActiveTab = useCallback((tab: 'Messages' | 'Tâches') => {
    setActiveTabState(tab)
    if (channelId) sessionStorage.setItem(`fc_tab:${channelId}`, tab)
  }, [channelId])
  // Restaurer l'onglet quand on change de canal (le composant n'est pas remonté)
  useEffect(() => {
    setActiveTabState(sessionStorage.getItem(`fc_tab:${channelId}`) === 'Tâches' ? 'Tâches' : 'Messages')
  }, [channelId])
  const [slowmodeCooldown, setSlowmodeCooldown] = useState(0)
  const slowmodeTimer = useRef<ReturnType<typeof setInterval>>()
  const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const [timeoutUntil, setTimeoutUntil] = useState<Date | null>(null)
  const [showNotifModal, setShowNotifModal] = useState(false)
  const [showFollow, setShowFollow] = useState(false)
  const bellRef = useRef<HTMLButtonElement>(null)

  // All hooks first — no conditional hooks
  const { data: serverData, isLoading: serverLoading } = useQuery({
    queryKey: ['server', serverId],
    queryFn: () => api.get(`/servers/${serverId}`).then(r => r.data),
    enabled: !!serverId,
    staleTime: 60_000,
  })

  const { data: messages = [], isError: messagesError, refetch: refetchMessages } = useQuery({
    queryKey: ['messages', serverId, channelId, highlightMessageId ?? null],
    queryFn: async () => {
      if (highlightMessageId) {
        try {
          const res = await api.get(
            `/servers/${serverId}/channels/${channelId}/messages?around=${highlightMessageId}&limit=50`
          )
          if (res.data?.length > 0) return openMessages('channel', channelId!, res.data as ChatMessage[])
        } catch {}
      }
      return api.get(`/servers/${serverId}/channels/${channelId}/messages`).then(r => openMessages('channel', channelId!, r.data as ChatMessage[]))
    },
    enabled: !!channelId && !!serverId,
    staleTime: highlightMessageId ? 0 : 30_000,
  })

  useEffect(() => {
    if (messages.length > 0 && channelId) {
      // When loading around a highlighted message, replace the store to avoid gaps
      if (highlightMessageId) clearChannel(channelId)
      addMessages(channelId, messages)
    }
  }, [messages, channelId])

  // Reset du reply et du cooldown slowmode quand on change de canal
  useEffect(() => {
    setReplyTo(null)
    setSlowmodeCooldown(0)
    clearInterval(slowmodeTimer.current)
  }, [channelId])

  // Marquer comme lu + reset load-more quand on ouvre un nouveau canal ou focus
  useEffect(() => {
    if (!channelId) return
    // Les badges (mentions comprises) de tous les appareils sont effacés par
    // l'événement READ_STATE_UPDATE que le serveur renvoie (App.tsx).
    const doMark = () => markRead(channelId, serverId || undefined)
    doMark()
    setHasMore(true)
    window.addEventListener('focus', doMark)
    return () => window.removeEventListener('focus', doMark)
  }, [channelId, serverId])

  // Reset hasMore when highlight changes (around-load replaces store content)
  useEffect(() => {
    if (highlightMessageId) setHasMore(true)
  }, [highlightMessageId])

  // Re-subscribe après reconnexion WS (sinon les messages du canal n'arrivent plus)
  useEffect(() => {
    if (!channelId) return
    return onOpen(() => subscribeChannel(channelId))
  }, [channelId])

  useEffect(() => {
    if (!channelId) return
    subscribeChannel(channelId)
    const offs = [
      on('MESSAGE_CREATE', async (d: any) => {
        if (d.message.channel_id === channelId && !d.pending_attachments) addMessage(await openMessage('channel', channelId, d.message))
      }),
      on('MESSAGE_UPDATE', async (d: any) => {
        if (d.channel_id !== channelId) return
        if (!d.enc) {
          updateMessage(channelId, d.message_id, { content: d.content, edited_at: d.edited_at })
          return
        }
        // Édition chiffrée : auteur = auteur du message en mémoire (lié à l'AAD).
        const author = useChat.getState().messagesByChannel[channelId]?.find(m => m.id === d.message_id)?.author_id
        const body = author ? await openBody('channel', channelId, d.enc, author, d.client_msg_id) : null
        if (body) {
          updateMessage(channelId, d.message_id, {
            content: body.t, enc: d.enc, client_msg_id: d.client_msg_id, e2e: 'ok', e2e_body: body, unencrypted: false, edited_at: d.edited_at,
          })
        }
      }),
      // Clés du salon reçues : les messages en attente s'ouvrent.
      on('E2E_KEYS', async (d: any) => {
        if (d.conv_kind !== 'channel' || d.conv_id !== channelId) return
        const opened = await reopenLocked('channel', channelId, useChat.getState().messagesByChannel[channelId] ?? [])
        opened.forEach((m, id) => updateMessage(channelId, id, m as Partial<ChatMessage>))
        qc.invalidateQueries({ queryKey: ['pinned', channelId] })
        qc.invalidateQueries({ queryKey: ['poll'] })
      }),
      on('MESSAGE_DELETE', (d: any) => {
        if (d.channel_id === channelId) deleteMessage(channelId, d.message_id)
      }),
      on('REACTION_ADD', (d: any) => {
        if (d.channel_id === channelId) addReaction(channelId, d.message_id, d.emoji, d.user_id, d.user_id === meId, !!d.is_super)
      }),
      on('REACTION_REMOVE', (d: any) => {
        if (d.channel_id === channelId) removeReaction(channelId, d.message_id, d.emoji, d.user_id, d.user_id === meId, !!d.is_super)
      }),
      on('TYPING_START', (d: any) => {
        if (d.channel_id === channelId) {
          const uid: string = d.user_id
          setTyping(channelId, uid, d.username ?? 'Utilisateur')
          const old = typingTimers.current.get(uid)
          if (old) clearTimeout(old)
          const tid = setTimeout(() => {
            typingTimers.current.delete(uid)
            clearTyping(channelId, uid)
          }, 5000)
          typingTimers.current.set(uid, tid)
        }
      }),
      on('MESSAGE_ATTACHMENT_ADDED', (d: any) => {
        if (d.channel_id === channelId) {
          const msgs = useChat.getState().messagesByChannel[channelId] ?? []
          if (msgs.find(m => m.id === d.message_id)) {
            mergeAttachments(channelId, d.message_id, d.attachments)
          } else {
            qc.invalidateQueries({ queryKey: ['messages', serverId, channelId] })
          }
        }
      }),
      on('MESSAGE_PIN_UPDATE', (d: any) => {
        if (d.channel_id === channelId) {
          updateMessage(channelId, d.message_id, { pinned: d.pinned })
          qc.invalidateQueries({ queryKey: ['pinned', channelId] })
        }
      }),
      on('USER_TIMEOUT', (d: any) => {
        if (d.server_id === serverId) setTimeoutUntil(new Date(d.expires_at))
      }),
      on('USER_TIMEOUT_LIFTED', (d: any) => {
        if (d.server_id === serverId) setTimeoutUntil(null)
      }),
      on('CHANNEL_PURGE', (d: any) => {
        if (d.channel_id === channelId) {
          clearChannel(channelId)
          toast.success(t('channel.purged', { n: d.deleted ?? '' }))
        }
      }),
    ]
    return () => {
      offs.forEach(off => off())
      typingTimers.current.forEach(clearTimeout)
      typingTimers.current.clear()
    }
  }, [channelId, serverId, meId])

  useEffect(() => () => clearInterval(slowmodeTimer.current), [])

  // Ctrl+F global → toggle recherche dans ce canal
  useEffect(() => {
    const handler = () => { setShowSearch(s => !s); setShowPinned(false); setActiveThreadId(null) }
    window.addEventListener('forgechat:toggle-search', handler)
    return () => window.removeEventListener('forgechat:toggle-search', handler)
  }, [])

  const startSlowmodeCooldown = (delay: number) => {
    setSlowmodeCooldown(delay)
    clearInterval(slowmodeTimer.current)
    slowmodeTimer.current = setInterval(() => {
      setSlowmodeCooldown(prev => {
        if (prev <= 1) { clearInterval(slowmodeTimer.current); return 0 }
        return prev - 1
      })
    }, 1000)
  }

  const sendMsg = useMutation({
    // Chiffré dès que j'ai une clé (AutoMod et aperçu de lien faits ici) ; mentions en métadonnées.
    mutationFn: ({ content, reply_to, expires_at_seconds, files }: { content: string | null; reply_to?: string; expires_at_seconds?: number | null; files?: PreparedFiles }) =>
      postMessage(serverId!, channelId!, content ?? '', body =>
        api.post(`/servers/${serverId}/channels/${channelId}/messages`, { ...body, reply_to, expires_at_seconds, has_attachments: !!files?.count }),
      filesExtra(files)),
    onError: (e: any) => {
      if (isQueued(e)) { toast(t('offline.queued')); return }
      if (e?.response?.status === 429) {
        const delay = e?.response?.data?.retry_after ?? currentChannel?.slowmode_delay ?? 30
        startSlowmodeCooldown(delay)
        toast.error(t('channel.slowmodeWait', { s: delay }))
      } else {
        toast.error(channelSendError(e, e?.response?.data?.error || e?.response?.data?.message || t('channel.sendFailed')))
      }
    },
  })

  const deleteMsg = useMutation({
    mutationFn: (msgId: string) =>
      api.delete(`/servers/${serverId}/channels/${channelId}/messages/${msgId}`),
    onSuccess: () => toast.success(t('channel.deleted')),
    onError: () => toast.error(t('channel.deleteFailed')),
  })

  const editMsg = useMutation({
    mutationFn: ({ msgId, content }: { msgId: string; content: string }) =>
      editMessage(serverId!, channelId!, content,
        useChat.getState().messagesByChannel[channelId!]?.find(m => m.id === msgId)?.client_msg_id,
        body => api.patch(`/servers/${serverId}/channels/${channelId}/messages/${msgId}`, body)),
    onError: (e) => toast.error(channelSendError(e, t('channel.editFailed'))),
  })

  // Salon chiffré : clés distribuées aux membres arrivés depuis, et à la clé du serveur.
  const encrypted = useChannelEncrypted(channelId)
  useEffect(() => {
    if (encrypted && channelId) void completeChannelKeys(channelId)
  }, [encrypted, channelId])

  const loadMore = useCallback(async (): Promise<boolean> => {
    if (!channelId || !serverId || !hasMore) return false
    const store = useChat.getState()
    const msgs = store.messagesByChannel[channelId] ?? []
    if (msgs.length === 0) return false
    const oldestId = msgs[0].id
    try {
      const { data } = await api.get(
        `/servers/${serverId}/channels/${channelId}/messages?before=${oldestId}&limit=50`
      )
      if (data.length === 0) { setHasMore(false); return false }
      addMessages(channelId, await openMessages('channel', channelId, data), true)
      if (data.length < 50) setHasMore(false)
      return true
    } catch (e: any) {
      // Curseur invalide (404) → pas de nouveaux messages à charger
      if (e?.response?.status === 404) setHasMore(false)
      return false
    }
  }, [channelId, serverId, hasMore])

  // Auto-redirect vers le dernier canal visité (sinon premier canal texte)
  // — DOIT être avant tout return conditionnel
  useEffect(() => {
    if (!channelId && !isSplit && serverId && serverData) {
      const chans: any[] = serverData?.channels ?? []
      const navigable = (c: any) => !c.archived && !c.hidden &&
        (c.type === 'text' || c.type === 'announcement' || c.type === 'forum' || c.type === 'media')
      const lastId = localStorage.getItem(`fc_last_channel:${serverId}`)
      const last = lastId ? chans.find((c: any) => c.id === lastId && navigable(c)) : undefined
      const target = last ?? chans.find((c: any) => c.type === 'text' || c.type === 'announcement')
      if (target) nav(`/servers/${serverId}/channels/${target.id}`, { replace: true, state: { autoNav: true } })
    }
  }, [channelId, serverData, serverId, isSplit])

  // Mémoriser le canal courant comme dernier visité pour ce serveur
  useEffect(() => {
    if (channelId && serverId && !isSplit) {
      localStorage.setItem(`fc_last_channel:${serverId}`, channelId)
    }
  }, [channelId, serverId, isSplit])

  // Tous les hooks doivent être AVANT tout return conditionnel (React Rules of Hooks)
  const { canPost, canSendBase, canManageMessages, canManageChannels } = useMemo(() => {
    const SEND_MESSAGES_BIT = 1 << 1
    const MANAGE_MESSAGES_BIT = 1 << 3
    const MANAGE_CHANNELS_BIT = 1 << 4
    const ADMINISTRATOR_BIT = 1 << 31
    const myRoleIds: string[] = (serverData?.my_role_ids ?? []).map(String)
    const allRoles: any[] = serverData?.roles ?? []
    const everyoneRole = allRoles.find((r: any) => r.is_everyone)
    const myRoles = allRoles.filter((r: any) => myRoleIds.includes(String(r.id)))
    const myPerms = myRoles.reduce((acc: number, r: any) => acc | Number(r.permissions), 0)
      | (everyoneRole ? Number(everyoneRole.permissions) : 0)
    const isOwner = serverData?.server?.owner_id === meId
    const hasAdmin = isOwner || !!(myPerms & ADMINISTRATOR_BIT)
    return {
      canPost: hasAdmin || !!(myPerms & MANAGE_MESSAGES_BIT),
      canSendBase: hasAdmin || !!(myPerms & SEND_MESSAGES_BIT),
      canManageMessages: hasAdmin || !!(myPerms & MANAGE_MESSAGES_BIT),
      canManageChannels: hasAdmin || !!(myPerms & MANAGE_CHANNELS_BIT),
    }
  }, [serverData, meId])

  // Fils automatiques (comme Slack) : répondre ouvre le fil du message ; nombre de réponses sous chaque message.
  const autoThreads = !!(serverData?.channels ?? []).find((c: any) => c.id === channelId)?.auto_threads
  const { data: autoThreadCounts } = useQuery({
    queryKey: ['threads', channelId, 'counts'],
    queryFn: () => api.get<{ parent_message_id: string | null; message_count: number }[]>(
      `/servers/${serverId}/channels/${channelId}/threads`, { params: { limit: 100 } },
    ).then(r => new Map(r.data.flatMap(th => th.parent_message_id ? [[th.parent_message_id, th.message_count] as const] : []))),
    enabled: autoThreads && !!serverId && !!channelId,
    staleTime: 15_000,
  })
  useEffect(() => {
    if (!autoThreads) return
    return on('THREAD_CREATE', (d: any) => {
      if (d.channel_id === channelId) qc.invalidateQueries({ queryKey: ['threads', channelId, 'counts'] })
    })
  }, [autoThreads, channelId, on, qc])
  const autoThreadTitle = (msgId: string) => {
    const m = useChat.getState().messagesByChannel[channelId ?? '']?.find(x => x.id === msgId)
    return (m?.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || t('autothread.reply')
  }

  // Noms des salons pour le filtre dans: de la recherche locale.
  useEffect(() => {
    for (const c of serverData?.channels ?? []) rememberConvName(c.id, c.name, serverId)
  }, [serverData?.channels, serverId])

  // Titre de page contextuel : "#canal — Serveur | ForgeChat"
  const _titleCh: string | undefined = (serverData?.channels ?? []).find((c: any) => c.id === channelId)?.name
  const _titleSrv: string | undefined = serverData?.server?.name ?? (serverData as any)?.name
  useEffect(() => {
    if (!_titleCh || !_titleSrv || isSplit) return
    const prefix = document.title.match(/^\(\d+\)\s*/)?.[0] ?? ''
    document.title = `${prefix}#${_titleCh} — ${_titleSrv} | ForgeChat`
    return () => {
      const p = document.title.match(/^\(\d+\)\s*/)?.[0] ?? ''
      document.title = `${p}ForgeChat`
    }
  }, [_titleCh, _titleSrv, isSplit, channelId])

  const handleSend = useCallback(async (content: string, replyToId: string | undefined, files: import('../components/chat/MessageInput').FileWithTtl[] | undefined, ttlSeconds: number | null | undefined) => {
    try {
      // Fichiers chiffrés sur l'appareil avant l'envoi : leurs clés vont dans le message chiffré.
      const prepared = await prepareFiles('channel', channelId!, files ?? [])
      const res = await sendMsg.mutateAsync({ content: content || null, reply_to: replyToId, expires_at_seconds: ttlSeconds, files: prepared })
      const msgId = res.data?.id
      if (prepared.count && msgId) {
        await postWithUploadProgress(`/servers/${serverId}/channels/${channelId}/messages/${msgId}/attachments`, prepared.form, prepared.bytes)
      }
    } catch {
      // erreur déjà notifiée par sendMsg — restaurer le texte comme brouillon
      // pour que l'utilisateur ne perde pas son message
      if (content && channelId) useDraft.getState().setDraft(channelId, content)
    }
  }, [sendMsg, serverId, channelId])

  if (!serverId) return null

  const server = serverData?.server ?? serverData
  // Vérification Gate : si le serveur a la vérification activée et que le membre n'est pas vérifié
  const needsVerification =
    !!server?.verification_enabled &&
    serverData?.member?.verified_at == null &&
    serverData !== undefined

  if (needsVerification) {
    return (
      <VerificationGateModal
        serverId={serverId}
        serverName={server?.name ?? ''}
        rules={server?.verification_rules ?? ''}
        onVerified={() => {
          qc.invalidateQueries({ queryKey: ['server', serverId] })
        }}
      />
    )
  }

  // Onboarding : questions d'accueil, après la barrière de vérification.
  if (serverData?.member?.onboarding_pending) {
    return <OnboardingModal serverId={serverId} serverName={server?.name ?? ''} />
  }

  const channels: any[] = serverData?.channels ?? []

  if (!channelId && serverLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={32} className="animate-spin text-fc-accent" />
      </div>
    )
  }

  if (!channelId && serverData) {
    const firstText = channels.find((c: any) => c.type === 'text' || c.type === 'announcement')
    if (!firstText) {
      return (
        <WelcomeScreen
          server={serverData.server ?? serverData}
          channels={channels}
        />
      )
    }
    // Auto-navigate to first text channel when no channelId in URL
    nav(`/servers/${serverId}/channels/${firstText.id}`, { replace: true, state: { autoNav: true } })
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={32} className="animate-spin text-fc-accent" />
      </div>
    )
  }

  if (!channelId) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={32} className="animate-spin text-fc-accent" />
      </div>
    )
  }

  const currentChannel = channels.find((c: any) => c.id === channelId)
  const isAnnouncement = currentChannel?.type === 'announcement'

  if (currentChannel?.is_nsfw && !nsfwOk) {
    return <NsfwGate name={currentChannel.name} onConfirm={confirmerNsfw} onBack={() => (onClose ? onClose() : window.history.back())} />
  }

  // Canal Scène — roster speakers/audience + main levée, mesh vocal en écoute
  // seule pour l'audience (cf. StageChannel.tsx)
  if (currentChannel?.type === 'stage' && serverId) {
    return (
      <StageChannel
        channelId={channelId}
        serverId={serverId}
        currentUserId={meId ?? ''}
        isSpeaker={false}
        isModerator={canManageChannels}
      />
    )
  }

  // Canal vocal / vidéo — même composant WebRTC
  if (currentChannel?.type === 'voice' || currentChannel?.type === 'video') {
    return <VoiceVideoPage channel={currentChannel} serverId={serverId} />
  }

  // Forum
  // Salon média : un forum affiché en grille, publication = média obligatoire
  if (currentChannel?.type === 'forum' || currentChannel?.type === 'media') {
    return <ForumPage media={currentChannel.type === 'media'} channel={currentChannel} serverId={serverId} channelId={channelId} canManageMessages={canManageMessages} />
  }

  // Canal texte / annonces
  return (
    <div className="relative flex h-full overflow-hidden">
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header canal */}
        <div className={`fc-chat-header flex items-center gap-2 px-4 py-2.5 border-b shadow-sm flex-shrink-0 min-h-[48px] ${
          isSplit ? 'border-fc-accent/30 bg-fc-accent/5' : 'border-fc-bg'
        }`}>
          {/* Bouton "retour à la liste des canaux" sur mobile */}
          {!isSplit && (
            <button
              className="md:hidden min-w-[44px] min-h-[44px] flex items-center justify-center p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition flex-shrink-0"
              onClick={openSidebar}
              aria-label={t('channel.openChannels')}
              title={t('channel.channels')}
            >
              <ChevronLeft size={20} />
            </button>
          )}
          {isSplit && (
            <span className="hidden md:inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-fc-accent bg-fc-accent/15 px-1.5 py-0.5 rounded flex-shrink-0">
              Split
            </span>
          )}
          <span className="text-fc-muted flex-shrink-0">{channelIcon(currentChannel?.type ?? 'text')}</span>
          <span className="font-semibold text-white truncate min-w-0 max-w-[140px] sm:max-w-[240px] md:max-w-none" title={currentChannel?.name}>{currentChannel?.name ?? '...'}</span>
          <ChannelLock channelId={channelId} />
          {currentChannel?.type === 'announcement' && (
            <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full font-medium">{t('channel.announcements')}</span>
          )}
          {(currentChannel?.slowmode_delay ?? 0) > 0 && (
            <span className="flex items-center gap-1 text-xs bg-fc-hover text-fc-muted px-2 py-0.5 rounded-full" title={t('channels.slowmode', { s: currentChannel.slowmode_delay })}>
              <Timer size={11} />
              {currentChannel.slowmode_delay >= 3600
                ? `${currentChannel.slowmode_delay / 3600}h`
                : currentChannel.slowmode_delay >= 60
                ? `${currentChannel.slowmode_delay / 60}m`
                : `${currentChannel.slowmode_delay}s`}
            </span>
          )}
          {currentChannel?.topic && (
            <>
              <div className="w-px h-4 bg-fc-hover mx-1" />
              <span className="text-sm text-fc-muted truncate hidden md:block">{currentChannel.topic}</span>
            </>
          )}
          <div className="ml-auto flex items-center gap-1">
            {currentChannel && serverId && (
              <DisappearingControl kind="channel" id={currentChannel.id} serverId={serverId}
                value={currentChannel.disappear_seconds ?? null} canEdit={canManageChannels} />
            )}
            {isAnnouncement && (
              <button
                onClick={() => setShowFollow(true)}
                className="px-2 py-1 text-xs font-medium rounded border border-fc-hover text-fc-muted hover:text-white hover:bg-fc-hover transition"
                title={t('channel.followTitle')}
              >
                {t('channel.follow')}
              </button>
            )}
            {currentChannel && (
              <span className="hidden md:flex">
                <ExportConversationButton
                  channelId={channelId}
                  channelName={currentChannel.name ?? channelId}
                />
              </span>
            )}
            <button
              onClick={() => { setShowThreadSidebar(s => !s); setShowPinned(false); setShowSearch(false); setActiveThreadId(null); setActiveDirectThreadId(null) }}
              className={`flex min-w-[36px] min-h-[36px] items-center justify-center p-1.5 rounded hover:bg-fc-hover transition ${showThreadSidebar ? 'text-white' : 'text-fc-muted hover:text-white'}`}
              title={t('channel.threads')}
              aria-label={t('channel.threads')}
              aria-pressed={showThreadSidebar}
            >
              <MessagesSquare size={18} />
            </button>
            <button
              onClick={() => { setShowSearch(!showSearch); setShowPinned(false); setActiveThreadId(null) }}
              className={`min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center p-1.5 rounded hover:bg-fc-hover transition ${showSearch ? 'text-white' : 'text-fc-muted hover:text-white'}`}
              title={t('channel.searchTitle')}
              aria-label={t('channel.searchLabel')}
              aria-pressed={showSearch}
            >
              <Search size={18} />
            </button>
            <button
              onClick={() => { setShowPinned(!showPinned); setShowSearch(false); setActiveThreadId(null) }}
              className={`flex min-w-[36px] min-h-[36px] items-center justify-center p-1.5 rounded hover:bg-fc-hover transition ${showPinned ? 'text-white' : 'text-fc-muted hover:text-white'}`}
              title={t('channel.pinned')}
              aria-label={t('channel.pinned')}
              aria-pressed={showPinned}
            >
              <Pin size={18} />
            </button>
            <div className="relative">
              <button
                ref={bellRef}
                onClick={() => setShowNotifModal(v => !v)}
                className={`flex min-w-[36px] min-h-[36px] items-center justify-center p-1.5 rounded hover:bg-fc-hover transition ${showNotifModal ? 'text-white' : 'text-fc-muted hover:text-white'}`}
                title={t('channel.notifications')}
                aria-label={t('channel.notifSettings')}
                aria-pressed={showNotifModal}
              >
                <Bell size={18} />
              </button>
              {showNotifModal && channelId && (
                <ChannelNotifModal
                  channelId={channelId}
                  channelName={currentChannel?.name ?? ''}
                  onClose={() => setShowNotifModal(false)}
                  anchorRef={bellRef}
                />
              )}
            </div>
            <button
              onClick={() => setShowMembers(!showMembers)}
              className={`flex p-1.5 min-w-[36px] min-h-[36px] items-center justify-center rounded hover:bg-fc-hover transition ${showMembers ? 'text-white' : 'text-fc-muted hover:text-white'}`}
              title={t('channel.members')}
              aria-label={t('channel.members')}
              aria-pressed={showMembers}
            >
              <Users size={18} />
            </button>

            {/* Bouton split / fermer split — desktop uniquement */}
            {!isSplit ? (
              <button
                onClick={() => setSplitChannelId(channelId ?? null)}
                className="hidden md:flex p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition"
                title={t('channel.splitOpenTitle')}
                aria-label={t('channel.splitOpen')}
              >
                <Columns2 size={18} />
              </button>
            ) : (
              <>
                {params.channelId && params.channelId !== channelId && (
                  <button
                    onClick={() => {
                      const mainCh = params.channelId
                      if (!mainCh || !channelId) return
                      setSplitChannelId(mainCh)
                      nav(`/servers/${serverId}/channels/${channelId}`)
                    }}
                    className="hidden md:flex p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition"
                    title={t('channel.splitSwapTitle')}
                    aria-label={t('channel.splitSwap')}
                  >
                    <ArrowLeftRight size={18} />
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="hidden md:flex p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition"
                  title={t('channel.splitCloseTitle')}
                  aria-label={t('channel.splitClose')}
                >
                  <X size={18} />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Propriétaire d'un serveur sans clé de récupération : invite une fois par session. */}
        {/* Propriétaire : rechiffrement de l'ancien contenu de tout le serveur, en arrière-plan. */}
        {!isSplit && serverData?.server?.owner_id === meId && (
          <>
            <ServerKeyPrompt serverId={serverId} serverName={server?.name ?? ''} />
            <ServerReencrypt serverId={serverId} />
          </>
        )}

        {/* Onglets Messages / Tâches */}
        <div
          role="tablist"
          aria-label={t('channel.viewLabel')}
          className="flex border-b border-fc-hover px-4 flex-shrink-0"
          onKeyDown={e => {
            const tabs = ['Messages', 'Tâches'] as const
            const idx = tabs.indexOf(activeTab)
            if (e.key === 'ArrowRight') setActiveTab(tabs[(idx + 1) % tabs.length])
            else if (e.key === 'ArrowLeft') setActiveTab(tabs[(idx - 1 + tabs.length) % tabs.length])
          }}
        >
          {(['Messages', 'Tâches'] as const).map(tab => (
            <button
              key={tab}
              role="tab"
              id={`tab-${tab}`}
              aria-selected={activeTab === tab}
              aria-controls={`tabpanel-${tab}`}
              tabIndex={activeTab === tab ? 0 : -1}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm transition ${
                activeTab === tab
                  ? 'border-b-2 border-fc-accent text-white'
                  : 'text-fc-muted hover:text-white'
              }`}
            >
              {tab === 'Messages' ? t('channel.tabMessages') : t('channel.tabTasks')}
            </button>
          ))}
        </div>

        {/* Vue Tâches */}
        {activeTab === 'Tâches' && serverId && channelId && (
          <div id="tabpanel-Tâches" role="tabpanel" aria-labelledby="tab-Tâches" className="flex-1 overflow-hidden p-3">
            <KanbanBoard serverId={serverId} channelId={channelId} />
          </div>
        )}

        {/* Messages + Input (masqués en vue Tâches) */}
        {activeTab === 'Messages' && (
          <div id="tabpanel-Messages" role="tabpanel" aria-labelledby="tab-Messages" className="contents">
            {highlightMessageId && (
              <div className="flex items-center justify-between gap-2 px-4 py-1.5 bg-fc-accent/10 border-b border-fc-accent/20 flex-shrink-0">
                <span className="text-xs text-fc-accent">{t('channel.contextView')}</span>
                <button
                  onClick={() => nav(`/servers/${serverId}/channels/${channelId}`)}
                  className="text-xs text-fc-accent hover:underline font-medium flex-shrink-0"
                >
                  {t('channel.latest')}
                </button>
              </div>
            )}
            <ThreadCountsContext.Provider value={autoThreads ? autoThreadCounts ?? null : null}>
            <MessageList
              key={channelId}
              channelId={channelId}
              serverId={serverId}
              loadError={messagesError}
              onRetryLoad={() => refetchMessages()}
              onDeleteMessage={(id) => deleteMsg.mutate(id)}
              onEditMessage={(id, content) => editMsg.mutate({ msgId: id, content })}
              onOpenThread={(msgId) => { setActiveThreadId(msgId); setShowPinned(false); setShowSearch(false) }}
              onAddReaction={(msgId, emoji) =>
                api.put(`/servers/${serverId}/channels/${channelId}/messages/${msgId}/reactions/${encodeURIComponent(emoji)}`)
              }
              onPinMessage={(msgId, pinned) =>
                (pinned
                  ? api.delete(`/servers/${serverId}/channels/${channelId}/messages/${msgId}/pin`)
                  : api.post(`/servers/${serverId}/channels/${channelId}/messages/${msgId}/pin`))
                  .then(() => toast.success(pinned ? t('channel.unpinned') : t('channel.pinnedOk')))
                  .catch(() => toast.error(pinned ? t('channel.unpinFailed') : t('channel.pinFailed')))
              }
              onPublishMessage={isAnnouncement && canManageMessages ? (msgId) =>
                api.post(`/servers/${serverId}/channels/${channelId}/messages/${msgId}/crosspost`)
                  .then(r => toast.success(t('channel.published', { n: r.data?.delivered ?? 0 })))
                  .catch((e: any) => toast.error(e?.response?.data?.error ?? t('channel.publishFailed')))
                : undefined}
              onReply={(msg) => autoThreads
                ? (setActiveThreadId(msg.id), setShowPinned(false), setShowSearch(false))
                : setReplyTo({ id: msg.id, author_username: msg.author_username, content: msg.content ?? null })}
              onLoadMore={loadMore}
              initialHighlightId={highlightMessageId}
              canManageMessages={canManageMessages}
            />
            </ThreadCountsContext.Provider>

            {/* Indicateur de frappe — canal serveur */}
            <div
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="px-4 flex-shrink-0 h-5 flex items-center"
            >
              {typingUsers.length > 0 && (
                <span className="text-xs text-fc-muted flex items-center gap-1.5">
                  <span className="flex gap-0.5 items-center" aria-hidden>
                    {[0, 1, 2].map(i => (
                      <span key={i} className="w-1.5 h-1.5 bg-fc-muted rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </span>
                  <span>
                    {typingUsers.length === 1
                      ? t('channel.typingOne', { name: typingUsers[0] })
                      : typingUsers.length <= 3
                      ? t('channel.typingFew', { names: typingUsers.join(', ') })
                      : t('channel.typingMany')}
                  </span>
                </span>
              )}
            </div>

            {/* Countdown slowmode */}
            {slowmodeCooldown > 0 && (
              <div className="flex items-center gap-2 px-4 py-1.5 bg-yellow-500/10 border-t border-yellow-500/20 text-yellow-400 text-xs">
                <Timer size={12} />
                <span>{t('channel.slowmodeBefore')} <strong>{slowmodeCooldown}s</strong> {t('channel.slowmodeAfter')}</span>
              </div>
            )}

            {/* Bannière timeout */}
            {timeoutUntil && (
              <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border-t border-red-500/20 text-red-400 text-xs">
                <Timer size={12} />
                <span>{t('channel.timedOutUntil')} <strong>{timeoutUntil.toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' })}</strong></span>
              </div>
            )}

        {/* Input — canal d'annonces sans permission */}
        {isAnnouncement && !canPost && (
          <div className="flex items-center gap-2 px-4 py-3 bg-fc-channel/60 border-t border-fc-hover text-fc-muted text-sm">
            <Megaphone size={16} className="text-yellow-400 flex-shrink-0" />
            <span>{t('channel.announceOnly')}</span>
          </div>
        )}
        {serverData?.lockdown && <LockdownBanner />}
        {/* Salon sans SEND_MESSAGES (overrides compris, calculé par le serveur ;
            repli sur le masque des rôles) : zone de saisie grisée au lieu d'un 403. */}
        {(!isAnnouncement || canPost) && !(currentChannel?.can_send ?? canSendBase) && (
          <div className="mx-4 mb-4 mt-1 flex items-center gap-2 px-4 py-3 rounded-lg bg-fc-input/50 text-fc-muted text-sm cursor-not-allowed select-none" aria-disabled="true">
            <Lock size={15} className="flex-shrink-0" />
            <span>{t('channel.noSendPermission')}</span>
          </div>
        )}
        {(!isAnnouncement || canPost) && (currentChannel?.can_send ?? canSendBase) && <MessageInput
          channelId={channelId}
          serverId={serverId}
          placeholder={timeoutUntil ? t('channel.timedOut') : slowmodeCooldown > 0 ? t('channel.waitSlowmode', { s: slowmodeCooldown }) : t('channel.messageIn', { name: currentChannel?.name ?? '...' })}
          onSend={handleSend}
          onEdit={(msgId, content) => editMsg.mutate({ msgId, content })}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          sending={sendMsg.isPending || !!timeoutUntil}
        />}
          </div>
        )}
      </div>

      {/* Thread panel (depuis message) */}
      {activeThreadId && (
        <ThreadPanel
          key={activeThreadId}
          serverId={serverId}
          channelId={channelId}
          parentMessageId={activeThreadId}
          autoTitle={autoThreads ? autoThreadTitle(activeThreadId) : undefined}
          onClose={() => setActiveThreadId(null)}
        />
      )}

      {/* Thread panel (depuis sidebar fils) */}
      {activeDirectThreadId && !activeThreadId && (
        <ThreadPanel
          key={activeDirectThreadId}
          serverId={serverId}
          channelId={channelId}
          threadId={activeDirectThreadId}
          onClose={() => setActiveDirectThreadId(null)}
        />
      )}

      {/* Sidebar fils de discussion */}
      {showThreadSidebar && !activeThreadId && !activeDirectThreadId && (
        <ThreadSidebar
          serverId={serverId}
          channelId={channelId}
          onSelectThread={(threadId) => {
            setActiveDirectThreadId(threadId)
            setShowThreadSidebar(false)
          }}
          onClose={() => setShowThreadSidebar(false)}
        />
      )}

      {/* Panneau épingles */}
      {showPinned && !activeThreadId && (
        <PinnedPanel
          serverId={serverId}
          channelId={channelId}
          channelName={currentChannel?.name ?? ''}
          onClose={() => setShowPinned(false)}
        />
      )}

      {/* Panneau recherche */}
      {showSearch && !activeThreadId && (
        <SearchPanel
          serverId={serverId}
          channelId={channelId}
          channelName={currentChannel?.name ?? ''}
          onClose={() => setShowSearch(false)}
          channelEncrypted={!!encrypted}
          localMessages={encrypted ? loadedMessages : undefined}
        />
      )}

      {/* Liste membres */}
      {showFollow && currentChannel && <FollowChannelModal channelId={currentChannel.id} channelName={currentChannel.name} onClose={() => setShowFollow(false)} />}
      {showMembers && !activeThreadId && !activeDirectThreadId && !showPinned && !showSearch && !showThreadSidebar && <MemberList serverId={serverId} onClose={() => setShowMembers(false)} />}
    </div>
  )
}
