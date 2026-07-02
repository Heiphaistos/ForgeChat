import { useEffect, useState, useCallback, useRef, useContext } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Hash, Users, Bell, Pin, Search, Volume2, Video, Megaphone, MessagesSquare, Radio, Loader2, Timer, Columns2, X, ChevronLeft } from 'lucide-react'
import { SplitContext } from '../contexts/SplitContext'
import { useMobile } from '../contexts/MobileContext'
import ExportConversationButton from '../components/chat/ExportConversationButton'
import api from '../api/client'
import { useChat } from '../store/chat'
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
import ForumPage from './ForumPage'
import ThreadPanel from '../components/chat/ThreadPanel'
import ThreadSidebar from '../components/chat/ThreadSidebar'
import WelcomeScreen from '../components/chat/WelcomeScreen'
import VerificationGateModal from '../components/modals/VerificationGateModal'
import KanbanBoard from '../components/tasks/KanbanBoard'
import toast from 'react-hot-toast'
import ChannelNotifModal from '../components/modals/ChannelNotifModal'

function channelIcon(type: string, size = 18) {
  const cls = `flex-shrink-0`
  switch (type) {
    case 'voice': return <Volume2 size={size} className={cls} />
    case 'video': return <Video size={size} className={cls} />
    case 'announcement': return <Megaphone size={size} className={cls} />
    case 'forum': return <MessagesSquare size={size} className={cls} />
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
  const serverId = params.serverId
  const channelId = forcedChannelId ?? params.channelId

  const { setSplitChannelId } = useContext(SplitContext)
  const { openSidebar } = useMobile()
  const [searchParams] = useSearchParams()
  const nav = useNavigate()
  const highlightMessageId = searchParams.get('highlight')
  const { addMessages, addMessage, updateMessage, deleteMessage, mergeAttachments, addReaction, removeReaction, setTyping, clearTyping, clearChannel } = useChat()
  const { on, onOpen, subscribeChannel } = useWs()
  const meId = useAuth(s => s.user?.id)
  const markRead = useUnread(s => s.markRead)
  const qc = useQueryClient()
  const [showMembers, setShowMembers] = useState(() => window.innerWidth >= 768)
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [activeDirectThreadId, setActiveDirectThreadId] = useState<string | null>(null)
  const [showThreadSidebar, setShowThreadSidebar] = useState(false)
  const [showPinned, setShowPinned] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [activeTab, setActiveTab] = useState<'Messages' | 'Tâches'>('Messages')
  const [slowmodeCooldown, setSlowmodeCooldown] = useState(0)
  const slowmodeTimer = useRef<ReturnType<typeof setInterval>>()
  const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const [timeoutUntil, setTimeoutUntil] = useState<Date | null>(null)
  const [showNotifModal, setShowNotifModal] = useState(false)
  const bellRef = useRef<HTMLButtonElement>(null)

  // All hooks first — no conditional hooks
  const { data: serverData, isLoading: serverLoading } = useQuery({
    queryKey: ['server', serverId],
    queryFn: () => api.get(`/servers/${serverId}`).then(r => r.data),
    enabled: !!serverId,
  })

  const { data: messages = [] } = useQuery({
    queryKey: ['messages', serverId, channelId, highlightMessageId ?? null],
    queryFn: async () => {
      if (highlightMessageId) {
        try {
          const res = await api.get(
            `/servers/${serverId}/channels/${channelId}/messages?around=${highlightMessageId}&limit=50`
          )
          if (res.data?.length > 0) return res.data
        } catch {}
      }
      return api.get(`/servers/${serverId}/channels/${channelId}/messages`).then(r => r.data)
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

  // Reset du reply quand on change de canal pour éviter d'envoyer une réponse au mauvais canal
  useEffect(() => { setReplyTo(null) }, [channelId])

  // Marquer comme lu + reset load-more quand on ouvre un nouveau canal ou focus
  useEffect(() => {
    if (!channelId) return
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
      on('MESSAGE_CREATE', (d: any) => {
        if (d.message.channel_id === channelId && !d.pending_attachments) addMessage(d.message)
      }),
      on('MESSAGE_UPDATE', (d: any) => {
        if (d.channel_id === channelId) updateMessage(channelId, d.message_id, { content: d.content, edited_at: d.edited_at })
      }),
      on('MESSAGE_DELETE', (d: any) => {
        if (d.channel_id === channelId) deleteMessage(channelId, d.message_id)
      }),
      on('REACTION_ADD', (d: any) => {
        if (d.channel_id === channelId) addReaction(channelId, d.message_id, d.emoji, d.user_id, d.user_id === meId)
      }),
      on('REACTION_REMOVE', (d: any) => {
        if (d.channel_id === channelId) removeReaction(channelId, d.message_id, d.emoji, d.user_id, d.user_id === meId)
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
          toast.success(`${d.deleted ?? ''} messages supprimés`)
        }
      }),
    ]
    return () => offs.forEach(off => off())
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
    mutationFn: ({ content, reply_to, expires_at_seconds, has_attachments }: { content: string | null; reply_to?: string; expires_at_seconds?: number | null; has_attachments?: boolean }) =>
      api.post(`/servers/${serverId}/channels/${channelId}/messages`, { content, reply_to, expires_at_seconds, has_attachments }),
    onError: (e: any) => {
      if (e?.response?.status === 429) {
        const delay = e?.response?.data?.retry_after ?? currentChannel?.slowmode_delay ?? 30
        startSlowmodeCooldown(delay)
        toast.error(`Mode lent — attendez ${delay}s avant d'envoyer`)
      } else {
        const msg = e?.response?.data?.error || e?.response?.data?.message || "Échec de l'envoi"
        toast.error(msg)
      }
    },
  })

  const deleteMsg = useMutation({
    mutationFn: (msgId: string) =>
      api.delete(`/servers/${serverId}/channels/${channelId}/messages/${msgId}`),
    onSuccess: () => toast.success('Message supprimé'),
    onError: () => toast.error('Suppression impossible'),
  })

  const editMsg = useMutation({
    mutationFn: ({ msgId, content }: { msgId: string; content: string }) =>
      api.patch(`/servers/${serverId}/channels/${channelId}/messages/${msgId}`, { content }),
    onError: () => toast.error('Modification impossible'),
  })

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
      addMessages(channelId, data, true)
      if (data.length < 50) setHasMore(false)
      return true
    } catch (e: any) {
      // Curseur invalide (404) → pas de nouveaux messages à charger
      if (e?.response?.status === 404) setHasMore(false)
      return false
    }
  }, [channelId, serverId, hasMore])

  // Auto-redirect vers le premier canal texte — DOIT être avant tout return conditionnel
  useEffect(() => {
    if (!channelId && !isSplit && serverId && serverData) {
      const chans: any[] = serverData?.channels ?? []
      const firstText = chans.find((c: any) => c.type === 'text' || c.type === 'announcement')
      if (firstText) nav(`/servers/${serverId}/channels/${firstText.id}`, { replace: true, state: { autoNav: true } })
    }
  }, [channelId, serverData, serverId, isSplit])

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

  // Calcul des permissions de l'utilisateur courant pour ce serveur
  const MANAGE_MESSAGES_BIT = 1 << 3
  const ADMINISTRATOR_BIT = 1 << 31
  const myRoleIds: string[] = (serverData?.my_role_ids ?? []).map(String)
  const allRoles: any[] = serverData?.roles ?? []
  const everyoneRole = allRoles.find((r: any) => r.is_everyone)
  const myRoles = allRoles.filter((r: any) => myRoleIds.includes(String(r.id)))
  const myPerms = myRoles.reduce((acc: number, r: any) => acc | Number(r.permissions), 0)
    | (everyoneRole ? Number(everyoneRole.permissions) : 0)
  const isOwner = serverData?.server?.owner_id === meId
  const canPost = isOwner || !!(myPerms & ADMINISTRATOR_BIT) || !!(myPerms & MANAGE_MESSAGES_BIT)
  const isAnnouncement = currentChannel?.type === 'announcement'

  // Canal vocal / vidéo / scène — même composant WebRTC
  if (currentChannel?.type === 'voice' || currentChannel?.type === 'video' || currentChannel?.type === 'stage') {
    return <VoiceVideoPage channel={currentChannel} serverId={serverId} />
  }

  // Forum
  if (currentChannel?.type === 'forum') {
    return <ForumPage channel={currentChannel} serverId={serverId} channelId={channelId} />
  }

  // Canal texte / annonces
  return (
    <div className="relative flex h-full overflow-hidden">
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header canal */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-fc-bg shadow-sm flex-shrink-0 min-h-[48px]">
          {/* Bouton "retour à la liste des canaux" sur mobile */}
          {!isSplit && (
            <button
              className="md:hidden flex items-center justify-center p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition flex-shrink-0"
              onClick={openSidebar}
              aria-label="Ouvrir la liste des canaux"
              title="Canaux"
            >
              <ChevronLeft size={20} />
            </button>
          )}
          <span className="text-fc-muted flex-shrink-0">{channelIcon(currentChannel?.type ?? 'text')}</span>
          <span className="font-semibold text-white truncate min-w-0 max-w-[140px] sm:max-w-[240px] md:max-w-none">{currentChannel?.name ?? '...'}</span>
          {currentChannel?.type === 'announcement' && (
            <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full font-medium">Annonces</span>
          )}
          {(currentChannel?.slowmode_delay ?? 0) > 0 && (
            <span className="flex items-center gap-1 text-xs bg-fc-hover text-fc-muted px-2 py-0.5 rounded-full" title={`Mode lent: ${currentChannel.slowmode_delay}s`}>
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
              className={`hidden md:flex p-1.5 rounded hover:bg-fc-hover transition ${showThreadSidebar ? 'text-white' : 'text-fc-muted hover:text-white'}`}
              title="Fils de discussion"
            >
              <MessagesSquare size={18} />
            </button>
            <button
              onClick={() => { setShowSearch(!showSearch); setShowPinned(false); setActiveThreadId(null) }}
              className={`p-1.5 rounded hover:bg-fc-hover transition ${showSearch ? 'text-white' : 'text-fc-muted hover:text-white'}`}
              title="Rechercher"
            >
              <Search size={18} />
            </button>
            <button
              onClick={() => { setShowPinned(!showPinned); setShowSearch(false); setActiveThreadId(null) }}
              className={`hidden md:flex p-1.5 rounded hover:bg-fc-hover transition ${showPinned ? 'text-white' : 'text-fc-muted hover:text-white'}`}
              title="Messages épinglés"
            >
              <Pin size={18} />
            </button>
            <div className="relative">
              <button
                ref={bellRef}
                onClick={() => setShowNotifModal(v => !v)}
                className={`hidden md:flex p-1.5 rounded hover:bg-fc-hover transition ${showNotifModal ? 'text-white' : 'text-fc-muted hover:text-white'}`}
                title="Notifications"
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
              className={`hidden lg:flex p-1.5 rounded hover:bg-fc-hover transition ${showMembers ? 'text-white' : 'text-fc-muted hover:text-white'}`}
              title="Liste des membres"
            >
              <Users size={18} />
            </button>

            {/* Bouton split / fermer split — desktop uniquement */}
            {!isSplit ? (
              <button
                onClick={() => setSplitChannelId(channelId ?? null)}
                className="hidden md:flex p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition"
                title="Ouvrir en split (Ctrl+Shift+S pour fermer)"
              >
                <Columns2 size={18} />
              </button>
            ) : (
              <button
                onClick={onClose}
                className="hidden md:flex p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition"
                title="Fermer le split (Ctrl+Shift+S)"
              >
                <X size={18} />
              </button>
            )}
          </div>
        </div>

        {/* Onglets Messages / Tâches */}
        <div className="flex border-b border-fc-hover px-4 flex-shrink-0">
          {(['Messages', 'Tâches'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm transition ${
                activeTab === tab
                  ? 'border-b-2 border-fc-accent text-white'
                  : 'text-fc-muted hover:text-white'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Vue Tâches */}
        {activeTab === 'Tâches' && serverId && channelId && (
          <div className="flex-1 overflow-hidden p-3">
            <KanbanBoard serverId={serverId} channelId={channelId} />
          </div>
        )}

        {/* Messages + Input (masqués en vue Tâches) */}
        {activeTab === 'Messages' && (
          <>
            {highlightMessageId && (
              <div className="flex items-center justify-between gap-2 px-4 py-1.5 bg-fc-accent/10 border-b border-fc-accent/20 flex-shrink-0">
                <span className="text-xs text-fc-accent">Affichage du contexte autour d'un message.</span>
                <button
                  onClick={() => nav(`/servers/${serverId}/channels/${channelId}`)}
                  className="text-xs text-fc-accent hover:underline font-medium flex-shrink-0"
                >
                  Voir les derniers messages →
                </button>
              </div>
            )}
            <MessageList
              channelId={channelId}
              serverId={serverId}
              onDeleteMessage={(id) => deleteMsg.mutate(id)}
              onEditMessage={(id, content) => editMsg.mutate({ msgId: id, content })}
              onOpenThread={(msgId) => { setActiveThreadId(msgId); setShowPinned(false); setShowSearch(false) }}
              onAddReaction={(msgId, emoji) =>
                api.put(`/servers/${serverId}/channels/${channelId}/messages/${msgId}/reactions/${encodeURIComponent(emoji)}`)
              }
              onPinMessage={(msgId) =>
                api.post(`/servers/${serverId}/channels/${channelId}/messages/${msgId}/pin`)
                  .then(() => toast.success('Message épinglé'))
                  .catch(() => toast.error('Épinglage impossible'))
              }
              onReply={(msg) => setReplyTo({ id: msg.id, author_username: msg.author_username, content: msg.content ?? null })}
              onLoadMore={loadMore}
              initialHighlightId={highlightMessageId}
            />

            {/* Countdown slowmode */}
            {slowmodeCooldown > 0 && (
              <div className="flex items-center gap-2 px-4 py-1.5 bg-yellow-500/10 border-t border-yellow-500/20 text-yellow-400 text-xs">
                <Timer size={12} />
                <span>Mode lent — attendez encore <strong>{slowmodeCooldown}s</strong> avant d'envoyer</span>
              </div>
            )}

            {/* Bannière timeout */}
            {timeoutUntil && (
              <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border-t border-red-500/20 text-red-400 text-xs">
                <Timer size={12} />
                <span>Vous êtes en sourdine jusqu'à <strong>{timeoutUntil.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</strong></span>
              </div>
            )}

        {/* Input — canal d'annonces sans permission */}
        {isAnnouncement && !canPost && (
          <div className="flex items-center gap-2 px-4 py-3 bg-fc-channel/60 border-t border-fc-hover text-fc-muted text-sm">
            <Megaphone size={16} className="text-yellow-400 flex-shrink-0" />
            <span>Seuls les modérateurs peuvent publier dans ce canal d'annonces.</span>
          </div>
        )}
        {(!isAnnouncement || canPost) && <MessageInput
          channelId={channelId}
          serverId={serverId}
          placeholder={timeoutUntil ? 'Vous êtes en sourdine' : slowmodeCooldown > 0 ? `Attendez ${slowmodeCooldown}s (mode lent)...` : `Message dans #${currentChannel?.name ?? '...'}`}
          onSend={async (content, replyToId, files, ttlSeconds) => {
            try {
              const res = await sendMsg.mutateAsync({ content: content || null, reply_to: replyToId, expires_at_seconds: ttlSeconds, has_attachments: !!(files && files.length > 0) })
              const msgId = res.data?.id
              if (files && files.length > 0 && msgId) {
                const fd = new FormData()
                for (const fw of files) {
                  fd.append('files', fw.file)
                  if (fw.ttlHours != null) fd.append('ttl_hours', String(fw.ttlHours))
                }
                await api.post(
                  `/servers/${serverId}/channels/${channelId}/messages/${msgId}/attachments`,
                  fd
                )
              }
            } catch {
              // erreur déjà gérée par sendMsg
            }
          }}
          onEdit={(msgId, content) => editMsg.mutate({ msgId, content })}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          sending={sendMsg.isPending || !!timeoutUntil}
        />}
          </>
        )}
      </div>

      {/* Thread panel (depuis message) */}
      {activeThreadId && (
        <ThreadPanel
          serverId={serverId}
          channelId={channelId}
          parentMessageId={activeThreadId}
          onClose={() => setActiveThreadId(null)}
        />
      )}

      {/* Thread panel (depuis sidebar fils) */}
      {activeDirectThreadId && !activeThreadId && (
        <ThreadPanel
          serverId={serverId}
          channelId={channelId}
          parentMessageId={activeDirectThreadId}
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
        />
      )}

      {/* Liste membres */}
      {showMembers && !activeThreadId && !activeDirectThreadId && !showPinned && !showSearch && !showThreadSidebar && <MemberList serverId={serverId} />}
    </div>
  )
}
