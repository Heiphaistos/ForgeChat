import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { useSwipeRightToClose } from '../../hooks/useSwipeClose'
import { X, Hash, Send, MessagesSquare, Pencil, Trash2, Check, Paperclip, Loader2, SmilePlus, Archive, ArchiveRestore, Lock, CornerUpLeft } from 'lucide-react'
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api, { mediaUrl } from '../../api/client'
import { useAuth } from '../../store/auth'
import { useWs } from '../../store/ws'
import { useFormatDate } from '../../hooks/useFormatDate'
import MediaContent from './MediaContent'
import { AttachmentList, PendingFiles, usePendingFiles } from './ThreadAttachments'
import { filesExtra, prepareFiles, uploadPrepared } from '../../e2e/files'
import { setOpenThread } from '../../hooks/useThreadNotifications'
import EmojiPicker from './EmojiPicker'
import LinkPreview, { extractFirstUrl } from './LinkPreview'
import { handleMarkdownShortcut } from '../../utils/mdShortcuts'
import { useEscapePanel } from '../../hooks/useEscapeKey'
import UserPopup from '../UserPopup'
import { isToday, isYesterday, format } from 'date-fns'
import toast from 'react-hot-toast'
import { dateLocale, t as tr } from '../../i18n'
import { channelSendError } from '../../e2e/channels'
import { createThread as createThreadE2E, openThreadMessages, openThreads, sendScoped, threadScopeOf } from '../../e2e/channelScopes'
import { sealBody } from '../../e2e/conversations'
import { UnencryptedBadge } from '../../e2e/ChannelBadge'
import { outgoingText } from '../../lib/uxPrefs'
import AnimatedImg, { isForeignImage } from '../ui/AnimatedImg'

interface Props {
  serverId: string
  channelId: string
  /** Fil ouvert depuis un message du salon (créé au premier envoi s'il n'existe pas) */
  parentMessageId?: string
  /** Fil ouvert directement (liste des fils, notification) */
  threadId?: string
  /** Salon à fils automatiques : le fil est créé à la première réponse, titré par ce texte. */
  autoTitle?: string
  onClose: () => void
}

const PAGE_SIZE = 50

// Brouillons par message parent — module-level, survivent à la fermeture du fil
const threadDrafts = new Map<string, string>()

export default function ThreadPanel({ serverId, channelId, parentMessageId, threadId: directThreadId, autoTitle, onClose }: Props) {
  // Clé de brouillon : le message parent, ou le fil ouvert directement
  const draftKey = parentMessageId ?? directThreadId ?? ''
  const { user } = useAuth()
  const { on, send } = useWs()
  const { formatShort } = useFormatDate()
  const [input, setInput] = useState(() => threadDrafts.get(draftKey) ?? '')
  // Brouillon conservé si on ferme/rouvre le fil (purgé à l'envoi via setInput(''))
  useEffect(() => {
    if (input.trim()) threadDrafts.set(draftKey, input)
    else threadDrafts.delete(draftKey)
  }, [input, draftKey])
  const pending = usePendingFiles()
  const [replyTo, setReplyTo] = useState<{ id: string; username: string; content: string } | null>(null)
  const [threadId, setThreadId] = useState<string | null>(directThreadId ?? null)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  // Pastille de date flottante affichée pendant le scroll (parité canaux/groupes)
  const [floatingDate, setFloatingDate] = useState<string | null>(null)
  const floatingDateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const openTime = useRef(Date.now())
  useEffect(() => { openTime.current = Date.now() }, [draftKey])
  useEffect(() => () => { if (floatingDateTimer.current) clearTimeout(floatingDateTimer.current) }, [])
  // Fermer le clavier virtuel quand on scrolle verticalement la liste (mobile)
  const kbDismissRef = useRef<{ x: number; y: number } | null>(null)
  // Double-tap sur un message → réaction ❤️ (parité canaux/groupes)
  const dblTapStart = useRef<{ x: number; y: number } | null>(null)
  const dblTapRef = useRef<{ msgId: string; time: number } | null>(null)
  // Popup profil au clic sur un avatar (parité canaux/groupes)
  const [userPopup, setUserPopup] = useState<{ userId: string; x: number; y: number } | null>(null)
  const qc = useQueryClient()
  useEscapePanel(onClose)

  // Paramètre utilisateur "aperçus de liens" (cache partagé avec MessageList)
  const { data: userSettings } = useQuery<Record<string, unknown>>({
    queryKey: ['user-settings'],
    queryFn: () => api.get('/user/settings').then(r => r.data),
    staleTime: 60_000,
  })
  const linkPreviewEnabled = (userSettings?.link_preview ?? false) as boolean

  // Recherche ciblée du fil (la liste des fils est paginée : il peut ne pas y figurer).
  // Clé préfixée par ['threads', channelId] : les invalidations existantes la couvrent.
  const lookup = threadId ?? directThreadId
  const { data: found = [], isLoading } = useQuery<any[]>({
    queryKey: ['threads', channelId, 'one', lookup ?? parentMessageId],
    queryFn: () => api.get(`/servers/${serverId}/channels/${channelId}/threads`, {
      params: lookup ? { thread_id: lookup } : { parent_message_id: parentMessageId },
    }).then(r => openThreads(channelId, r.data)),
    enabled: !!(lookup || parentMessageId),
  })
  const thread = found[0]

  useEffect(() => {
    if (thread) setThreadId(thread.id)
  }, [thread?.id])

  // Messages par pages de 50, du plus récent au plus ancien (curseur = id le plus ancien)
  const {
    data: msgPages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    // Fil chiffré : messages déchiffrés avec la portée du fil (attend son client_id).
    queryKey: ['thread-messages', threadId, thread?.client_id],
    queryFn: ({ pageParam }) => api.get<any[]>(`/servers/${serverId}/channels/${channelId}/threads/${threadId}/messages`, {
      params: { limit: PAGE_SIZE, ...(pageParam ? { before: pageParam } : {}) },
    }).then(r => openThreadMessages(channelId, thread, r.data)),
    initialPageParam: null as string | null,
    getNextPageParam: last => (last.length === PAGE_SIZE ? last[0]?.id ?? null : null),
    enabled: !!threadId && thread?.id === threadId,
  })
  const messages: any[] = msgPages ? [...msgPages.pages].reverse().flat() : []
  const lastMsgId: string | undefined = messages[messages.length - 1]?.id

  // Charger l'historique en conservant la position de lecture
  const listRef = useRef<HTMLDivElement>(null)
  const prevScrollHeight = useRef<number | null>(null)
  const loadOlder = () => {
    if (!hasNextPage || isFetchingNextPage) return
    prevScrollHeight.current = listRef.current?.scrollHeight ?? null
    fetchNextPage()
  }
  useLayoutEffect(() => {
    const el = listRef.current
    if (el && prevScrollHeight.current != null) {
      el.scrollTop += el.scrollHeight - prevScrollHeight.current
      prevScrollHeight.current = null
    }
  }, [messages.length])

  // Fil affiché : pas de notification globale pour lui, et lu jusqu'au dernier message
  useEffect(() => {
    if (!threadId) return
    setOpenThread(threadId)
    return () => setOpenThread(null)
  }, [threadId])
  useEffect(() => {
    if (!threadId || !lastMsgId) return
    api.post(`/servers/${serverId}/channels/${channelId}/threads/${threadId}/ack`)
      .then(() => qc.invalidateQueries({ queryKey: ['threads', channelId] }))
      .catch(() => {})
  }, [threadId, lastMsgId, serverId, channelId, qc])

  // Temps réel — écouter les nouveaux messages du thread via WS
  useEffect(() => {
    if (!threadId) return
    const offMsg = on('THREAD_MESSAGE', (d: any) => {
      if (d.thread_id === threadId) {
        qc.invalidateQueries({ queryKey: ['thread-messages', threadId] })
      }
    })
    const offAtt = on('THREAD_ATTACHMENT_ADDED', (d: any) => {
      if (d.thread_id === threadId) {
        qc.invalidateQueries({ queryKey: ['thread-messages', threadId] })
      }
    })
    const offUpdate = on('THREAD_UPDATE', (d: any) => {
      if (d.thread_id === threadId) {
        qc.invalidateQueries({ queryKey: ['threads', channelId] })
      }
    })
    const offEdit = on('THREAD_MESSAGE_EDIT', (d: any) => {
      if (d.thread_id === threadId) {
        qc.invalidateQueries({ queryKey: ['thread-messages', threadId] })
      }
    })
    const offDelete = on('THREAD_MESSAGE_DELETE', (d: any) => {
      if (d.thread_id === threadId) {
        qc.invalidateQueries({ queryKey: ['thread-messages', threadId] })
      }
    })
    const offReact = on('THREAD_REACTION_TOGGLE', (d: any) => {
      if (d.thread_id === threadId) {
        qc.invalidateQueries({ queryKey: ['thread-messages', threadId] })
      }
    })
    const offTyping = on('THREAD_TYPING', (d: any) => {
      if (d.thread_id !== threadId || d.user_id === user?.id) return
      setTypingUsers(prev => {
        const entry = prev[d.user_id]
        if (entry) clearTimeout(entry.timer)
        const timer = setTimeout(() => {
          setTypingUsers(p => { const { [d.user_id]: _, ...rest } = p; return rest })
        }, 3000)
        return { ...prev, [d.user_id]: { username: d.username, timer } }
      })
    })
    return () => { offMsg(); offAtt(); offUpdate(); offEdit(); offDelete(); offReact(); offTyping() }
  }, [threadId, channelId, on, qc])

  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null)

  // Indicateur de frappe du thread (émission throttlée + réception WS)
  const [typingUsers, setTypingUsers] = useState<Record<string, { username: string; timer: ReturnType<typeof setTimeout> }>>({})
  const typingThrottle = useRef<number>(0)
  const emitTyping = () => {
    if (!threadId) return
    const now = Date.now()
    if (now - typingThrottle.current < 2000) return
    typingThrottle.current = now
    send({ type: 'THREAD_TYPING', thread_id: threadId, server_id: serverId })
  }
  useEffect(() => () => {
    setTypingUsers(prev => { Object.values(prev).forEach(e => clearTimeout(e.timer)); return {} })
  }, [threadId])
  const toggleReaction = useMutation({
    mutationFn: ({ msgId, emoji }: { msgId: string; emoji: string }) =>
      api.put(`/servers/${serverId}/channels/${channelId}/threads/${threadId}/messages/${msgId}/reactions/${encodeURIComponent(emoji)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['thread-messages', threadId] }),
    onError: () => toast.error(tr('thr.reactError')),
  })

  const editMessage = useMutation({
    // Même id client que le message (lié à l'AAD), ou un nouveau pour un ancien message en clair.
    mutationFn: ({ msgId, content }: { msgId: string; content: string }) =>
      sendScoped(serverId, channelId, scope(), content,
        body => api.patch(`/servers/${serverId}/channels/${channelId}/threads/${threadId}/messages/${msgId}`, body),
        { clientMsgId: messages.find(m => m.id === msgId)?.client_msg_id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['thread-messages', threadId] })
      setEditingMsgId(null)
      toast.success(tr('thr.edited'))
    },
    onError: (e) => toast.error(channelSendError(e, tr('thr.editError'))),
  })

  const deleteMessage = useMutation({
    mutationFn: (msgId: string) =>
      api.delete(`/servers/${serverId}/channels/${channelId}/threads/${threadId}/messages/${msgId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['thread-messages', threadId] })
      toast.success(tr('thr.deleted'))
    },
    onError: () => toast.error(tr('thr.deleteError')),
  })

  // Défiler en bas quand un message arrive en fin de fil (pas au chargement de l'historique)
  // (instantané au premier affichage : un défilement animé depuis le haut
  // déclencherait le chargement de l'historique)
  const hadMessages = useRef(false)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: hadMessages.current ? 'smooth' : 'auto' })
    if (lastMsgId) hadMessages.current = true
  }, [lastMsgId])

  /** Portée du fil ouvert (AAD) : envoi et édition seulement une fois le fil chargé. */
  const scope = () => {
    const s = threadScopeOf(channelId, thread)
    if (!s) throw new Error('E2E_WAITING')
    return s
  }

  const attachUrl = (tid: string, msgId: string) =>
    `/servers/${serverId}/channels/${channelId}/threads/${tid}/messages/${msgId}/attachments`

  const createThread = useMutation({
    // Salon chiffré : titre ET premier message chiffrés (portée du nouveau fil), fichiers aussi (clés dans le message, §12).
    mutationFn: async () => {
      const prepared = await prepareFiles('channel', channelId, pending.files.map(file => ({ file })))
      const res = await createThreadE2E(serverId, channelId, newTitle.trim() || autoTitle || '', input.trim(), parentMessageId,
        body => api.post(`/servers/${serverId}/channels/${channelId}/threads`, body), filesExtra(prepared))
      return Object.assign(res, { prepared })
    },
    onSuccess: async (res) => {
      const tid = res.data.thread?.id
      setInput('')
      setNewTitle('')
      setCreating(false)
      pending.clear()
      if (tid) setThreadId(tid)
      qc.invalidateQueries({ queryKey: ['threads', channelId] })
      toast.success(tr('thr.created'))
      if (tid && res.data.first_message_id && res.prepared.count > 0) {
        await uploadPrepared(attachUrl(tid, res.data.first_message_id), res.prepared).catch(() => toast.error(tr('common.error')))
        qc.invalidateQueries({ queryKey: ['thread-messages', tid] })
      }
    },
    onError: (e: any) => toast.error(channelSendError(e, e.response?.data?.error ?? tr('common.error'))),
  })

  const sendMessage = useMutation({
    mutationFn: async () => {
      const prepared = await prepareFiles('channel', channelId, pending.files.map(file => ({ file })))
      const res = await sendScoped(serverId, channelId, scope(), outgoingText(input.trim()), body => api.post(
        `/servers/${serverId}/channels/${channelId}/threads/${threadId}/messages`, { ...body, reply_to: replyTo?.id, has_attachments: prepared.count > 0 },
      ), undefined, filesExtra(prepared))
      return Object.assign(res, { prepared })
    },
    onSuccess: async (res) => {
      const msgId: string | undefined = res.data?.message?.id
      setInput('')
      setReplyTo(null)
      pending.clear()
      qc.invalidateQueries({ queryKey: ['thread-messages', threadId] })
      if (threadId && msgId && res.prepared.count > 0) {
        await uploadPrepared(attachUrl(threadId, msgId), res.prepared).catch(() => toast.error(tr('common.error')))
        qc.invalidateQueries({ queryKey: ['thread-messages', threadId] })
      }
    },
    onError: (e: any) => toast.error(channelSendError(e, e.response?.data?.error ?? tr('common.error'))),
  })

  // archive_thread (threads.rs) impose déjà côté serveur qu'un fil archivé/verrouillé
  // refuse tout nouveau message (403) -- mais aucune UI n'a jamais existé pour
  // basculer cet état : PATCH /threads/:id existait sans le moindre appelant.
  // Renommer : créateur du fil ou modérateur (contrôlé par le serveur). Titre chiffré
  // comme à la création (portée et id client du fil, auteur = créateur du fil).
  const [renaming, setRenaming] = useState<string | null>(null)
  const rename = useMutation({
    mutationFn: async (title: string) => {
      if (!thread?.client_id) throw new Error('E2E_WAITING')
      const sealed = await sealBody('channel', channelId, { t: title },
        { scope: scope(), clientMsgId: thread.client_id, author: thread.creator_id })
      return api.patch(`/servers/${serverId}/channels/${channelId}/threads/${threadId}`, { title_enc: sealed.enc })
    },
    onSuccess: () => {
      setRenaming(null)
      qc.invalidateQueries({ queryKey: ['threads', channelId] })
    },
    onError: (e: any) => toast.error(channelSendError(e, e.response?.data?.error ?? tr('common.error'))),
  })

  const toggleArchive = useMutation({
    mutationFn: () =>
      api.patch(`/servers/${serverId}/channels/${channelId}/threads/${threadId}`, {
        archived: !thread?.archived,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['threads', channelId] })
      toast.success(tr(thread?.archived ? 'thr.unarchived' : 'thr.archived'))
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? tr('common.error')),
  })

  const isLocked = !!thread?.locked || !!thread?.archived

  const canSend = !!input.trim() || (!!threadId && pending.files.length > 0)
  const handleSend = () => {
    if (!canSend) return
    // Limite serveur : 4000 caractères
    if (input.trim().length > 4000) {
      toast.error(tr('thr.tooLong', { n: input.trim().length }))
      return
    }
    if (!threadId) {
      createThread.mutate()
    } else {
      sendMessage.mutate()
    }
  }

  return (
    <div
      {...useSwipeRightToClose(onClose)}
      role="complementary"
      aria-label={tr('thr.panel')}
      className="absolute inset-0 z-10 md:relative md:inset-auto md:z-auto md:w-80 bg-fc-channel border-l border-fc-bg flex flex-col flex-shrink-0 panel-slide-right"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-3 border-b border-fc-bg flex-shrink-0">
        <MessagesSquare size={16} className="text-fc-muted" aria-hidden />
        <span className="font-semibold text-white text-sm flex-1">{tr('thr.panel')}</span>
        <button onClick={onClose} className="text-fc-muted hover:text-white transition p-1 rounded hover:bg-fc-hover" title={tr('common.close')} aria-label={tr('thr.closeA11y')}>
          <X size={16} />
        </button>
      </div>

      {/* Créer thread (fils automatiques : créé à la première réponse, sans étape) */}
      {!threadId && !isLoading && !autoTitle && (
        <div className="p-3 border-b border-fc-bg bg-fc-bg/30">
          {!creating ? (
            <button
              onClick={() => setCreating(true)}
              className="w-full text-center text-sm text-fc-accent hover:text-indigo-400 transition py-2"
            >
              {tr('thr.createFrom')}
            </button>
          ) : (
            <div className="space-y-2">
              <input
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder={tr('thr.titlePh')}
                enterKeyHint="next"
                autoCapitalize="sentences"
                className="w-full px-2 py-1.5 bg-fc-input rounded text-sm text-white outline-none focus:ring-1 focus:ring-fc-accent"
              />
              <div className="text-xs text-fc-muted">{tr('thr.orWrite')}</div>
            </div>
          )}
        </div>
      )}

      {/* Thread existant — infos */}
      {thread && (
        <div className="p-3 border-b border-fc-bg bg-fc-accent/5">
          <div className="flex items-center gap-1.5">
            <Hash size={13} className="text-fc-accent" />
            {renaming !== null ? (
              <input
                autoFocus
                value={renaming}
                maxLength={100}
                aria-label={tr('thr.newTitle')}
                onChange={e => setRenaming(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && renaming.trim()) rename.mutate(renaming.trim())
                  if (e.key === 'Escape') setRenaming(null)
                }}
                onBlur={() => setRenaming(null)}
                className="flex-1 min-w-0 px-1.5 py-0.5 bg-fc-input rounded text-sm text-white outline-none focus:ring-1 focus:ring-fc-accent"
              />
            ) : (
              <span className="text-sm font-medium text-white truncate flex-1">{thread.title}</span>
            )}
            {thread.client_id && (
              <button
                onClick={() => setRenaming(thread.title)}
                title={tr('thr.rename')}
                aria-label={tr('thr.rename')}
                className="p-1 text-fc-muted hover:text-fc-accent rounded hover:bg-fc-hover transition flex-shrink-0"
              >
                <Pencil size={13} />
              </button>
            )}
            {thread.locked && <Lock size={12} className="text-fc-muted flex-shrink-0" aria-label={tr('thr.locked')} />}
            <button
              onClick={() => toggleArchive.mutate()}
              disabled={toggleArchive.isPending}
              title={tr(thread.archived ? 'thr.unarchive' : 'thr.archive')}
              aria-label={tr(thread.archived ? 'thr.unarchive' : 'thr.archive')}
              className="p-1 text-fc-muted hover:text-fc-accent rounded hover:bg-fc-hover transition disabled:opacity-50 flex-shrink-0"
            >
              {thread.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
            </button>
          </div>
          <div className="text-xs text-fc-muted mt-0.5">
            {tr('thr.byline', { name: thread.creator_username, n: thread.message_count })}
          </div>
          {thread.archived && (
            <p className="text-xs text-fc-muted/80 mt-1 italic">{tr('thr.archivedRo')}</p>
          )}
        </div>
      )}

      {/* Messages */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto overscroll-contain p-3 space-y-3"
        onScroll={e => {
          // Pastille de date flottante : jour du dernier séparateur passé au-dessus
          // du viewport (ignoré pendant le scroll initial programmatique)
          if (Date.now() - openTime.current < 800) return
          // Défilement infini vers l'historique (hors défilement initial vers le bas)
          if (e.currentTarget.scrollTop < 60) loadOlder()
          const el = e.currentTarget
          const topEdge = el.getBoundingClientRect().top + 8
          let label: string | null = null
          el.querySelectorAll<HTMLElement>('[data-date-label]').forEach(d => {
            if (d.getBoundingClientRect().top < topEdge) label = d.dataset.dateLabel ?? null
          })
          if (label) {
            setFloatingDate(label)
            if (floatingDateTimer.current) clearTimeout(floatingDateTimer.current)
            floatingDateTimer.current = setTimeout(() => setFloatingDate(null), 1200)
          }
        }}
        onTouchStart={e => { kbDismissRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }}
        onTouchMove={e => {
          const s = kbDismissRef.current
          if (!s) return
          const dx = Math.abs(e.touches[0].clientX - s.x)
          const dy = Math.abs(e.touches[0].clientY - s.y)
          if (dy > 24 && dy > dx * 1.5) {
            kbDismissRef.current = null
            const el = document.activeElement as HTMLElement | null
            if (el && el.tagName === 'TEXTAREA') el.blur()
          }
        }}
      >
        {/* Pastille de date flottante pendant le scroll — sticky, h-0 + marge
            négative pour ne pas décaler le flux space-y-3 */}
        {floatingDate && (
          <div className="sticky top-1 z-20 h-0 -mb-3 flex justify-center pointer-events-none" aria-hidden>
            <span className="channel-fade-in px-3 py-1 rounded-full bg-fc-channel/90 border border-fc-hover shadow-lg text-[10px] font-semibold text-fc-text capitalize whitespace-nowrap backdrop-blur-sm">
              {floatingDate}
            </span>
          </div>
        )}
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-fc-accent border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!threadId && !isLoading && (
          <div className="text-center text-fc-muted text-sm py-8">
            <MessagesSquare size={32} className="mx-auto mb-2 opacity-30" />
            <p>{tr('hc.thr.empty')}</p>
          </div>
        )}

        {hasNextPage && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={loadOlder}
              disabled={isFetchingNextPage}
              className="text-xs text-fc-accent hover:underline disabled:opacity-50 flex items-center gap-1"
            >
              {isFetchingNextPage && <Loader2 size={12} className="animate-spin" aria-hidden />}
              {tr('thr.loadOlder')}
            </button>
          </div>
        )}

        {threadId && !isLoading && messages.length === 0 && (
          <div className="text-center text-fc-muted text-sm py-8">
            <MessagesSquare size={32} className="mx-auto mb-2 opacity-30" />
            <p>{tr('thr.empty')}</p>
          </div>
        )}

        {messages.map((msg: any, i: number) => {
          const isMe = msg.author_id === user?.id || msg.user_id === user?.id
          const prev: any = messages[i - 1]
          const msgDate = new Date(msg.created_at)
          const showDateDivider = !prev || new Date(prev.created_at).toDateString() !== msgDate.toDateString()
          const dateLabel = isToday(msgDate) ? tr('saved.today')
            : isYesterday(msgDate) ? tr('gdm.yesterday')
            : format(msgDate, tr('gdm.dateFormat'), { locale: dateLocale() })
          return (
            <div key={msg.id}>
            {showDateDivider && (
              <div className="flex items-center gap-3 my-2 px-1 select-none" role="separator" aria-label={dateLabel} data-date-label={dateLabel}>
                <div className="flex-1 h-px bg-fc-hover/70" />
                <span className="text-[10px] font-semibold text-fc-muted capitalize whitespace-nowrap px-2 py-0.5 rounded-full bg-fc-hover/50">
                  {dateLabel}
                </span>
                <div className="flex-1 h-px bg-fc-hover/70" />
              </div>
            )}
            <div
              className="flex gap-2 group"
              onTouchStart={e => { dblTapStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }}
              onTouchEnd={e => {
                const s = dblTapStart.current
                dblTapStart.current = null
                if (!s) return
                const dx = Math.abs(e.changedTouches[0].clientX - s.x)
                const dy = Math.abs(e.changedTouches[0].clientY - s.y)
                if (dx > 10 || dy > 10) { dblTapRef.current = null; return }
                const now = Date.now()
                const last = dblTapRef.current
                if (last && last.msgId === msg.id && now - last.time < 300) {
                  dblTapRef.current = null
                  if ('vibrate' in navigator) navigator.vibrate(15)
                  toggleReaction.mutate({ msgId: msg.id, emoji: '❤️' })
                } else {
                  dblTapRef.current = { msgId: msg.id, time: now }
                }
              }}
            >
              <button
                onClick={e => {
                  e.stopPropagation()
                  const uid = msg.author_id ?? msg.user_id
                  // Message importé / webhook (avatar d'un autre site) : ce n'est pas le membre qui l'a posté.
                  if (uid && !isForeignImage(msg.author?.avatar)) setUserPopup({ userId: uid, x: e.clientX, y: e.clientY })
                }}
                aria-label={tr('hc.p.profileOf', { name: msg.author?.username ?? msg.author_username ?? tr('hc.p.theAuthor') })}
                className="w-6 h-6 rounded-full bg-fc-accent flex items-center justify-center text-xs font-bold text-white flex-shrink-0 mt-0.5 overflow-hidden hover:ring-2 hover:ring-fc-accent/60 transition cursor-pointer"
              >
                {msg.author?.avatar
                  ? <AnimatedImg src={msg.author.avatar} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />
                  : msg.author?.username?.charAt(0).toUpperCase()}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-1.5 mb-0.5">
                  <span className={`text-xs font-semibold ${isMe ? 'text-fc-accent' : 'text-white'}`}>
                    {msg.author?.username ?? msg.author_username}
                  </span>
                  <span className="text-xs text-fc-muted">
                    {formatShort(msg.created_at)}
                  </span>
                  {msg.edited_at && (
                    <span className="text-[9px] text-fc-muted/60" title={tr('thr.edited')}>{tr('thr.editedTag')}</span>
                  )}
                  {msg.unencrypted === true && <UnencryptedBadge />}
                  {editingMsgId !== msg.id && !isLocked && (
                    <button
                      onClick={() => setReplyTo({ id: msg.id, username: msg.author?.username ?? '', content: msg.content ?? '' })}
                      className={`opacity-100 md:opacity-0 md:group-hover:opacity-100 p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded transition text-fc-muted hover:text-white ${isMe ? '' : 'ml-auto'}`}
                      title={tr('thr.reply')}
                      aria-label={tr('thr.replyA11y')}
                    ><CornerUpLeft size={12} aria-hidden /></button>
                  )}
                  {editingMsgId !== msg.id && (
                    <button
                      onClick={() => setReactionPickerFor(cur => cur === msg.id ? null : msg.id)}
                      className={`opacity-100 md:opacity-0 md:group-hover:opacity-100 p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded transition ${reactionPickerFor === msg.id ? 'text-fc-accent' : 'text-fc-muted hover:text-white'}`}
                      title={tr('thr.react')}
                      aria-label={tr('thr.reactA11y')}
                    ><SmilePlus size={12} aria-hidden /></button>
                  )}
                  {isMe && editingMsgId !== msg.id && msg.e2e !== 'locked' && (
                    <div className="opacity-100 md:opacity-0 md:group-hover:opacity-100 flex items-center gap-0.5 transition">
                      <button
                        onClick={() => { setEditingMsgId(msg.id); setEditContent(msg.content) }}
                        className="p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-fc-muted hover:text-white rounded transition"
                        title={tr('hc.common.edit')}
                        aria-label={tr('hc.common.edit')}
                      ><Pencil size={12} /></button>
                      <button
                        onClick={() => deleteMessage.mutate(msg.id)}
                        className="p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-fc-muted hover:text-red-400 rounded transition"
                        title={tr('hc.common.delete')}
                        aria-label={tr('hc.common.delete')}
                      ><Trash2 size={12} /></button>
                    </div>
                  )}
                </div>
                {editingMsgId === msg.id ? (
                  <div className="flex gap-1">
                    <textarea
                      value={editContent}
                      onChange={e => setEditContent(e.target.value)}
                      className="flex-1 px-2 py-1 bg-fc-input rounded text-xs text-white outline-none focus:ring-1 focus:ring-fc-accent resize-none"
                      rows={2}
                      autoFocus
                      enterKeyHint="done"
                      onKeyDown={e => {
                        if (handleMarkdownShortcut(e, editContent, setEditContent)) return
                        if (e.key === 'Escape') setEditingMsgId(null)
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          if (editContent.trim()) editMessage.mutate({ msgId: msg.id, content: editContent.trim() })
                        }
                      }}
                    />
                    <div className="flex flex-col gap-0.5">
                      <button
                        onClick={() => editContent.trim() && editMessage.mutate({ msgId: msg.id, content: editContent.trim() })}
                        disabled={!editContent.trim() || editMessage.isPending}
                        className="p-1 bg-fc-accent hover:bg-indigo-500 text-white rounded disabled:opacity-50"
                      ><Check size={10} /></button>
                      <button
                        onClick={() => setEditingMsgId(null)}
                        className="p-1 text-fc-muted hover:text-white rounded"
                      ><X size={10} /></button>
                    </div>
                  </div>
                ) : (
                  <>
                    {msg.reply_to && (
                      <div className="flex items-center gap-1 text-[11px] text-fc-muted mb-0.5 min-w-0">
                        <CornerUpLeft size={10} className="flex-shrink-0" aria-hidden />
                        {msg.reply_to_username
                          ? <span className="truncate"><span className="font-semibold">{msg.reply_to_username}</span> {msg.reply_to_content}</span>
                          : <span className="italic">{tr('thr.deleted')}</span>}
                      </div>
                    )}
                    <MediaContent text={msg.content ?? ''} className="text-sm text-fc-text leading-relaxed break-words" />
                    <AttachmentList attachments={msg.attachments} body={msg.e2e_body} />
                    {linkPreviewEnabled && msg.content && (() => {
                      // Message chiffré : aperçu calculé par l'expéditeur, jamais demandé au serveur.
                      if (msg.enc) return msg.e2e_body?.p ? <LinkPreview url={extractFirstUrl(msg.content) ?? ''} data={msg.e2e_body.p} /> : null
                      const url = extractFirstUrl(msg.content)
                      return url ? <LinkPreview url={url} /> : null
                    })()}
                    {/* Réactions */}
                    {(msg.reactions?.length > 0 || reactionPickerFor === msg.id) && (
                      <div className="flex flex-wrap items-center gap-1 mt-1 relative">
                        {(msg.reactions ?? []).map((r: any) => (
                          <button
                            key={r.emoji}
                            onClick={() => toggleReaction.mutate({ msgId: msg.id, emoji: r.emoji })}
                            className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs border transition ${
                              r.me ? 'bg-fc-accent/20 border-fc-accent/50 text-white' : 'bg-fc-hover/40 border-transparent text-fc-muted hover:border-fc-hover'
                            }`}
                            title={(r.users ?? []).join(', ')}
                            aria-label={`${tr(r.count > 1 ? 'thr.reaction.other' : 'thr.reaction.one', { emoji: r.emoji, n: r.count })}${r.users?.length ? ' — ' + r.users.join(', ') : ''}`}
                            aria-pressed={r.me}
                          >
                            <span aria-hidden>{r.emoji}</span>
                            <span>{r.count}</span>
                          </button>
                        ))}
                        {reactionPickerFor === msg.id && (
                          <EmojiPicker
                            serverId={serverId}
                            onPick={emoji => toggleReaction.mutate({ msgId: msg.id, emoji })}
                            onClose={() => setReactionPickerFor(null)}
                          />
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
            </div>
          )
        })}

        <div ref={bottomRef} />
      </div>

      {/* Input -- masqué si le fil est archivé/verrouillé (send_thread_message
          renvoie 403 dans ce cas, la zone de saisie serait trompeuse sinon) */}
      <div className="p-3 border-t border-fc-bg flex-shrink-0">
        {isLocked ? (
          <p className="text-xs text-fc-muted text-center py-2 italic">
            {tr(thread?.archived ? 'thr.isArchived' : 'thr.isLocked')}
          </p>
        ) : (
        <>
        {Object.keys(typingUsers).length > 0 && (
          <div role="status" aria-live="polite" className="text-[11px] text-fc-muted italic mb-1 px-1 truncate">
            {tr(Object.keys(typingUsers).length > 1 ? 'thr.typing.other' : 'thr.typing.one', { names: Object.values(typingUsers).map(t => t.username).join(', ') })}
          </div>
        )}
        {replyTo && (
          <div className="flex items-center gap-1.5 text-[11px] text-fc-muted mb-1 px-1 min-w-0">
            <CornerUpLeft size={11} className="flex-shrink-0" aria-hidden />
            <span className="truncate flex-1">{tr('thr.replyTo')} <span className="font-semibold text-fc-text">{replyTo.username}</span></span>
            <button type="button" onClick={() => setReplyTo(null)} aria-label={tr('thr.cancelReply')} className="hover:text-white"><X size={12} aria-hidden /></button>
          </div>
        )}
        <PendingFiles files={pending.files} onRemove={pending.remove} />
        <div className="flex gap-2 items-end">
          <textarea
            data-composer="thread"
            value={input}
            onChange={e => { setInput(e.target.value); emitTyping() }}
            onKeyDown={e => {
              if (handleMarkdownShortcut(e, input, setInput)) return
              if (e.key === 'ArrowUp' && !input && threadId) {
                const last = [...(messages as any[])].reverse().find((m: any) =>
                  m.author_id === user?.id || m.user_id === user?.id
                )
                if (last) { e.preventDefault(); setEditingMsgId(last.id); setEditContent(last.content ?? ''); return }
              }
              if (e.key === 'Escape' && replyTo) { setReplyTo(null); return }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            onPaste={pending.onPaste}
            onDrop={pending.onDrop}
            onDragOver={pending.onDragOver}
            placeholder={tr(threadId ? 'thr.replyPh' : 'thr.firstPh')}
            enterKeyHint="send"
            autoCapitalize="sentences"
            rows={2}
            className="flex-1 px-2.5 py-2 bg-fc-input rounded-lg text-sm text-white outline-none focus:ring-1 focus:ring-fc-accent resize-none"
          />
          <button
            type="button"
            onClick={pending.pick}
            title={tr('thr.attach')}
            aria-label={tr('thr.attach')}
            className="p-2 text-fc-muted hover:text-white rounded-lg hover:bg-fc-hover transition disabled:opacity-50 flex-shrink-0"
          >
            <Paperclip size={16} aria-hidden />
          </button>
          <button
            onClick={handleSend}
            disabled={!canSend || createThread.isPending || sendMessage.isPending}
            className="p-2 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg transition disabled:opacity-50 flex-shrink-0"
            title={tr('thr.send')} aria-label={tr('thr.send')}
          >
            <Send size={16} />
          </button>
        </div>
        </>
        )}
      </div>

      {userPopup && (
        <UserPopup
          userId={userPopup.userId}
          serverId={serverId}
          anchorX={userPopup.x}
          anchorY={userPopup.y}
          onClose={() => setUserPopup(null)}
        />
      )}
    </div>
  )
}
