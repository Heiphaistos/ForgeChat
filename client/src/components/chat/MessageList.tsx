import { useEffect, useRef, useState, useCallback, KeyboardEvent, useMemo } from 'react'
import { useCountdown } from '../../hooks/useCountdown'
import { format, isToday, isYesterday } from 'date-fns'
import { fr } from 'date-fns/locale'
import { Pencil, Trash2, SmilePlus, MessagesSquare, Check, X, Pin, CornerUpLeft, ChevronDown, Loader2, Bot, Clock, Bookmark, Forward, Bell, Languages, Flag, Copy, Link } from 'lucide-react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useAuth } from '../../store/auth'
import { useContextMenu } from '../ui/ContextMenu'
import { useChat } from '../../store/chat'
import { renderMarkdown } from '../../utils/markdown'
import UserPopup from '../UserPopup'
import ReactionPopup from './ReactionPopup'
import LinkPreview from './LinkPreview'
import EditHistoryModal from './EditHistoryModal'
import ForwardModal from './ForwardModal'
import ReminderModal from './ReminderModal'
import ReportModal from './ReportModal'
import LightboxModal from './LightboxModal'
import PollDisplay from './PollDisplay'
import { parseStickerMessage } from './StickerPicker'
import api from '../../api/client'
import toast from 'react-hot-toast'

interface Props {
  channelId: string
  serverId: string
  onDeleteMessage: (msgId: string) => void
  onEditMessage: (msgId: string, content: string) => void
  onOpenThread?: (msgId: string) => void
  onAddReaction?: (msgId: string, emoji: string) => void
  onPinMessage?: (msgId: string) => void
  onReply?: (msg: any) => void
  onLoadMore?: () => Promise<boolean>
  initialHighlightId?: string | null
  canManageMessages?: boolean
}

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉', '🔥', '👀']
const REACTION_PICKER_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👏', '🤔', '✅', '❌', '🚀', '💯', '😎', '🙏', '💪', '🤡', '👀', '🫡', '💀']
const DBLCLICK_EMOJIS = ['👍', '❤️', '😂', '🎉', '🔥']

function formatDate(dateStr: string) {
  const d = new Date(dateStr)
  if (isToday(d)) return `Aujourd'hui à ${format(d, 'HH:mm')}`
  if (isYesterday(d)) return `Hier à ${format(d, 'HH:mm')}`
  return format(d, 'dd/MM/yyyy HH:mm', { locale: fr })
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const URL_REGEX = /https?:\/\/[^\s<>"]+/g

const EMPTY_MESSAGES: any[] = []

function EphemeralBadge({ expiresAt }: { expiresAt: string }) {
  const remaining = useCountdown(expiresAt)
  return (
    <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-fc-red/20 text-fc-red font-medium">
      ⏱ {remaining}
    </span>
  )
}

function extractFirstUrl(content: string): string | null {
  const matches = content.match(URL_REGEX)
  return matches?.[0] ?? null
}

interface PopupState { userId: string; x: number; y: number }
interface ReactionPopupState { messageId: string; emoji: string; x: number; y: number; users: { user_id: string; username: string; avatar?: string }[] }

export default function MessageList({
  channelId,
  serverId,
  onDeleteMessage,
  onEditMessage,
  onOpenThread,
  onAddReaction,
  onPinMessage,
  onReply,
  onLoadMore,
  initialHighlightId,
  canManageMessages = false,
}: Props) {
  const { user } = useAuth()
  const nav = useNavigate()
  const avatarCtxMenu = useContextMenu()
  const [searchParams] = useSearchParams()
  const targetMsgId = searchParams.get('msg')

  const { data: customEmojisList = [] } = useQuery<{ name: string; url: string }[]>({
    queryKey: ['custom_emojis', serverId],
    queryFn: () => api.get(`/servers/${serverId}/emojis`).then(r => r.data),
    enabled: !!serverId,
    staleTime: 60_000,
  })

  const { data: userSettings } = useQuery<Record<string, unknown>>({
    queryKey: ['user-settings'],
    queryFn: () => api.get('/user/settings').then(r => r.data),
    staleTime: 300_000,
  })
  const linkPreviewEnabled = (userSettings?.link_preview ?? true) as boolean
  const groupingMs = ((userSettings?.message_grouping_minutes as number | undefined) ?? 5) * 60 * 1000
  const timeFormat = (userSettings?.time_format as string | undefined) ?? '24h'
  const dateFormat = (userSettings?.date_format as string | undefined) ?? 'DD/MM/YYYY'
  const showTimestamps = (userSettings?.show_timestamps as string | undefined) ?? 'hover'

  const formatTs = (dateStr: string) => {
    const d = new Date(dateStr)
    const timeFmt = timeFormat === '12h' ? 'hh:mm a' : 'HH:mm'
    if (isToday(d)) return `Aujourd'hui à ${format(d, timeFmt)}`
    if (isYesterday(d)) return `Hier à ${format(d, timeFmt)}`
    const dateFmt = dateFormat === 'MM/DD/YYYY' ? 'MM/dd/yyyy' : dateFormat === 'YYYY-MM-DD' ? 'yyyy-MM-dd' : 'dd/MM/yyyy'
    return format(d, `${dateFmt} ${timeFmt}`, { locale: fr })
  }
  const formatShortTs = (dateStr: string) => format(new Date(dateStr), timeFormat === '12h' ? 'hh:mm a' : 'HH:mm')

  const customEmojiMap = useMemo(() =>
    Object.fromEntries(customEmojisList.map(e => [e.name, e.url])),
    [customEmojisList]
  )
  const messages = useChat(s => s.messagesByChannel[channelId] ?? EMPTY_MESSAGES)
  const typing = useChat(s => s.typing[channelId])
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  // Timestamp d'entrée dans le canal = base pour le divider "Nouveaux messages"
  const channelOpenTime = useRef<number>(Date.now())
  useEffect(() => { channelOpenTime.current = Date.now(); initialScrollDone.current = false }, [channelId])
  const msgRefs = useRef<Record<string, HTMLDivElement>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [emojiPickerFor, setEmojiPickerFor] = useState<string | null>(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [newMsgCount, setNewMsgCount] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const loadingMoreRef = useRef(false)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [popup, setPopup] = useState<PopupState | null>(null)
  const [editHistoryMsg, setEditHistoryMsg] = useState<{ id: string } | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const editRef = useRef<HTMLTextAreaElement>(null)
  const isAtBottom = useRef(true)
  const initialScrollDone = useRef(false)

  // Scroll initial instantané au bas du canal (avant que smooth ne s'active)
  useEffect(() => {
    if (!initialScrollDone.current && messages.length > 0) {
      const el = containerRef.current
      if (el) {
        el.scrollTop = el.scrollHeight
        initialScrollDone.current = true
      }
    }
  }, [messages.length])

  useEffect(() => {
    if (!initialScrollDone.current) return
    if (isAtBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
      setNewMsgCount(0)
    } else {
      setNewMsgCount(c => c + 1)
    }
  }, [messages.length])

  // Purge des messages éphémères expirés côté client toutes les 5s
  useEffect(() => {
    const deleteMessage = useChat.getState().deleteMessage
    const id = setInterval(() => {
      const msgs = useChat.getState().messagesByChannel[channelId] ?? []
      msgs.forEach(m => {
        if (m.expires_at && new Date(m.expires_at) <= new Date()) {
          deleteMessage(channelId, m.id)
        }
      })
    }, 5000)
    return () => clearInterval(id)
  }, [channelId])

  // Animation du compteur de réactions quand le compte change (mise à jour WebSocket)
  useEffect(() => {
    const newBumped: Record<string, boolean> = {}
    messages.forEach(msg => {
      (msg.reactions ?? []).forEach((r: any) => {
        const key = `${msg.id}:${r.emoji}`
        const prev = prevCountsRef.current[key] ?? r.count
        if (r.count !== prev) newBumped[key] = true
      })
    })
    // Mettre à jour la map de référence
    const nextCounts: Record<string, number> = {}
    messages.forEach(msg => {
      (msg.reactions ?? []).forEach((r: any) => {
        nextCounts[`${msg.id}:${r.emoji}`] = r.count
      })
    })
    prevCountsRef.current = nextCounts
    if (Object.keys(newBumped).length > 0) {
      setBumped(newBumped)
      const t = setTimeout(() => setBumped({}), 200)
      return () => clearTimeout(t)
    }
  }, [messages])

  useEffect(() => {
    if (!initialHighlightId || messages.length === 0) return
    const timer = setTimeout(() => jumpToMessage(initialHighlightId), 300)
    return () => clearTimeout(timer)
  }, [initialHighlightId, messages.length])

  useEffect(() => {
    if (!targetMsgId || messages.length === 0) return
    const timer = setTimeout(() => jumpToMessage(targetMsgId), 300)
    return () => clearTimeout(timer)
  }, [targetMsgId, messages.length])

  useEffect(() => {
    if (editingId && editRef.current) {
      editRef.current.focus()
      editRef.current.selectionStart = editContent.length
    }
  }, [editingId])

  const handleScroll = useCallback(async () => {
    const el = containerRef.current
    if (!el) return
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    isAtBottom.current = fromBottom < 60
    setShowScrollBtn(fromBottom > 200)
    if (fromBottom < 60) setNewMsgCount(0)

    // Load more quand on touche le haut (ref évite la closure stale)
    if (el.scrollTop < 80 && !loadingMoreRef.current && onLoadMore) {
      loadingMoreRef.current = true
      setLoadingMore(true)
      const prevHeight = el.scrollHeight
      const hasMore = await onLoadMore()
      loadingMoreRef.current = false
      setLoadingMore(false)
      if (hasMore) {
        // Maintenir la position de scroll après chargement
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight - prevHeight
        })
      }
    }
  }, [onLoadMore])

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const jumpToMessage = (msgId: string) => {
    const el = msgRefs.current[msgId]
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setHighlightId(msgId)
      setTimeout(() => setHighlightId(null), 2000)
    }
  }

  const startEdit = (msgId: string, content: string) => {
    setEditingId(msgId)
    setEditContent(content)
    setEmojiPickerFor(null)
  }

  const confirmEdit = (msgId: string) => {
    if (editContent.trim() && editContent !== messages.find(m => m.id === msgId)?.content) {
      onEditMessage(msgId, editContent.trim())
    }
    setEditingId(null)
  }

  const cancelEdit = () => { setEditingId(null); setEditContent('') }

  const handleEditKey = (e: KeyboardEvent<HTMLTextAreaElement>, msgId: string) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirmEdit(msgId) }
    if (e.key === 'Escape') cancelEdit()
  }

  const openUserPopup = (e: React.MouseEvent, userId: string) => {
    e.stopPropagation()
    setPopup({ userId, x: e.clientX + 12, y: e.clientY - 40 })
  }

  const [reactionPopup, setReactionPopup] = useState<ReactionPopupState | null>(null)
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null)
  const [poppingReaction, setPoppingReaction] = useState<string | null>(null)
  const [bumped, setBumped] = useState<Record<string, boolean>>({})
  const prevCountsRef = useRef<Record<string, number>>({})
  const [forwardingMsg, setForwardingMsg] = useState<{ id: string } | null>(null)
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null)
  const [dblClickPopover, setDblClickPopover] = useState<{ msgId: string; x: number; y: number } | null>(null)
  const [reminderFor, setReminderFor] = useState<string | null>(null)
  const [reportingMsg, setReportingMsg] = useState<string | null>(null)
  const [translations, setTranslations] = useState<Record<string, string>>({})
  const [translatingId, setTranslatingId] = useState<string | null>(null)
  const density = localStorage.getItem('fc_density') ?? 'normal'
  const compact = density === 'compact' || density === 'ultra-compact'
  const ultraCompact = density === 'ultra-compact'
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; msg: any } | null>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressTarget = useRef<{ x: number; y: number; msg: any } | null>(null)

  const startLongPress = (e: React.TouchEvent, msg: any) => {
    const t = e.touches[0]
    longPressTarget.current = { x: t.clientX, y: t.clientY, msg }
    longPressTimer.current = setTimeout(() => {
      if (longPressTarget.current) setContextMenu(longPressTarget.current)
    }, 500)
  }
  const cancelLongPress = () => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null }
    longPressTarget.current = null
  }

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    document.addEventListener('click', close)
    document.addEventListener('contextmenu', close)
    return () => { document.removeEventListener('click', close); document.removeEventListener('contextmenu', close) }
  }, [!!contextMenu])
  const isImage = (ct: string) => ct.startsWith('image/')
  const isVideo = (ct: string) => ct.startsWith('video/')

  const removeReactionMut = useMutation({
    mutationFn: ({ msgId, emoji }: { msgId: string; emoji: string }) =>
      api.delete(`/servers/${serverId}/channels/${channelId}/messages/${msgId}/reactions/${encodeURIComponent(emoji)}`),
    onError: () => toast.error('Impossible de retirer la réaction'),
  })

  const toggleReaction = (msgId: string, emoji: string) => {
    const msgs = useChat.getState().messagesByChannel[channelId] ?? []
    const msg = msgs.find(m => m.id === msgId)
    const reaction = msg?.reactions.find(r => r.emoji === emoji)
    if (reaction?.me) {
      removeReactionMut.mutate({ msgId, emoji })
    } else {
      onAddReaction?.(msgId, emoji)
    }
    const reactionKey = `${msgId}:${emoji}`
    setPoppingReaction(reactionKey)
    setTimeout(() => setPoppingReaction(null), 300)
  }

  const saveMessage = useMutation({
    mutationFn: ({ message_id, channel_id, server_id }: { message_id: string; channel_id: string; server_id: string }) =>
      api.post('/saved', { message_id, channel_id, server_id }),
    onSuccess: () => toast.success('Message sauvegardé'),
    onError: () => toast.error('Erreur lors de la sauvegarde'),
  })

  const handleReactionHover = async (e: React.MouseEvent, messageId: string, emoji: string) => {
    try {
      const res = await api.get(`/reactions?message_id=${messageId}&emoji=${encodeURIComponent(emoji)}`)
      const users = res.data?.users ?? []
      setReactionPopup({ messageId, emoji, x: e.clientX, y: e.clientY, users })
    } catch {
      // silencieux si l'API échoue
    }
  }

  const translateMessage = useCallback(async (messageId: string) => {
    if (translatingId === messageId) return
    setTranslatingId(messageId)
    try {
      const { data } = await api.post(`/messages/${messageId}/translate`, { target_lang: 'fr' })
      setTranslations(prev => ({ ...prev, [messageId]: data.translated }))
    } catch {
      toast.error('Traduction indisponible')
    } finally {
      setTranslatingId(null)
    }
  }, [translatingId])

  return (
    <div className="flex-1 relative flex flex-col overflow-hidden channel-fade-in">
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto px-2 md:px-4 py-2 space-y-0.5 message-list-container"
        onClick={() => { setEmojiPickerFor(null); setPopup(null); setReactionPickerFor(null); setDblClickPopover(null) }}
        onScroll={handleScroll}
      >
        {/* Loader "plus de messages" */}
        {loadingMore && (
          <div className="flex justify-center py-3">
            <Loader2 size={18} className="animate-spin text-fc-muted" />
          </div>
        )}

        {messages.map((msg, i) => {
          const prev = messages[i - 1]
          const isGrouped =
            prev &&
            prev.author_id === msg.author_id &&
            new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime() < groupingMs

          const isOwn = msg.author_id === user?.id
          const isEditing = editingId === msg.id
          const isHighlighted = highlightId === msg.id
          const msgTs = new Date(msg.created_at).getTime()
          const prevTs = prev ? new Date(prev.created_at).getTime() : 0
          const isFirstUnread = msgTs >= channelOpenTime.current && prevTs < channelOpenTime.current
          // Animer uniquement les messages qui arrivent en temps réel (après le chargement initial)
          const isLiveMsg = initialScrollDone.current && msgTs >= channelOpenTime.current

          return (
            <div key={msg.id} className={isLiveMsg ? 'msg-enter' : undefined}>
            {isFirstUnread && (
              <div className="flex items-center gap-2 my-2 px-2 select-none">
                <div className="flex-1 h-px bg-red-400/60" />
                <span className="text-xs font-semibold text-red-400 uppercase tracking-wide whitespace-nowrap">Nouveaux messages</span>
                <div className="flex-1 h-px bg-red-400/60" />
              </div>
            )}
            <div
              id={`msg-${msg.id}`}
              ref={el => { if (el) msgRefs.current[msg.id] = el }}
              className={`group flex items-start gap-3 px-2 rounded relative transition-colors duration-300
                ${compact ? 'py-0.5' : 'py-1'}
                ${isEditing ? 'bg-fc-hover/50' : isHighlighted ? 'bg-fc-accent/20' : msg.expires_at ? 'bg-red-500/5 border-l-2 border-red-500/30 hover:bg-red-500/8' : 'hover:bg-fc-hover/30'}`}
              onDoubleClick={e => {
                e.stopPropagation()
                setDblClickPopover({ msgId: msg.id, x: e.clientX, y: e.clientY })
              }}
              onContextMenu={e => {
                e.preventDefault()
                e.stopPropagation()
                setContextMenu({ x: e.clientX, y: e.clientY, msg })
              }}
              onTouchStart={e => startLongPress(e, msg)}
              onTouchEnd={cancelLongPress}
              onTouchMove={cancelLongPress}
            >
              {/* Avatar */}
              {!ultraCompact && (
                <div className={`flex-shrink-0 mt-0.5 ${compact ? 'w-7' : 'w-8 md:w-10'}`}>
                  {/* Heure au survol pour les messages de continuation */}
                  {isGrouped && showTimestamps !== 'never' && (
                    <span className="opacity-0 group-hover:opacity-100 transition text-[9px] text-fc-muted font-mono select-none flex items-center justify-center h-full">
                      {formatShortTs(msg.created_at)}
                    </span>
                  )}
                  {!isGrouped && (
                    <button
                      className={`rounded-full bg-fc-accent flex items-center justify-center font-bold text-sm text-white overflow-hidden hover:opacity-80 transition ${compact ? 'w-7 h-7' : 'w-8 h-8 md:w-10 md:h-10'}`}
                      onClick={e => openUserPopup(e, msg.author_id)}
                      onContextMenu={e => {
                        e.preventDefault()
                        e.stopPropagation()
                        avatarCtxMenu.open(e, [
                          { label: 'Voir le profil', onClick: () => nav(`/users/${msg.author_id}`) },
                          { label: 'Envoyer un message', onClick: () => {
                            api.post('/dms', { user_id: msg.author_id }).then(r => nav(`/dms/${r.data.id}`)).catch(() => {})
                          }, disabled: msg.author_id === user?.id },
                          { label: `Mentionner @${msg.author_username}`, onClick: () => {
                            const el = document.querySelector<HTMLTextAreaElement>('textarea[data-message-input]')
                            if (el) {
                              const pos = el.selectionStart ?? el.value.length
                              const mention = `@${msg.author_username} `
                              const newVal = el.value.slice(0, pos) + mention + el.value.slice(pos)
                              el.focus()
                              const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
                              setter?.call(el, newVal)
                              el.dispatchEvent(new Event('input', { bubbles: true }))
                              const newPos = pos + mention.length
                              setTimeout(() => el.setSelectionRange(newPos, newPos), 0)
                            }
                          }},
                          { separator: true },
                          { label: 'Copier l\'ID', onClick: () => navigator.clipboard.writeText(msg.author_id) },
                        ])
                      }}
                      title={`Profil de ${msg.author_username}`}
                    >
                      {msg.author_avatar
                        ? <img src={msg.author_avatar} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                        : msg.author_username.charAt(0).toUpperCase()}
                    </button>
                  )}
                </div>
              )}

              {/* Contenu */}
              <div className="flex-1 min-w-0">
                {!isGrouped && !ultraCompact && (
                  <div className="flex items-baseline gap-2 mb-0.5">
                    <button
                      className="font-semibold text-white text-sm hover:underline cursor-pointer"
                      onClick={e => openUserPopup(e, msg.author_id)}
                    >
                      {msg.author_username}
                    </button>
                    {msg.author_verified && (
                      <span
                        className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-fc-accent text-white text-[10px] font-bold ml-0.5 flex-shrink-0"
                        title="Utilisateur vérifié"
                      >✓</span>
                    )}
                    {msg.author_is_bot && (
                      <span className="inline-flex items-center gap-0.5 bg-indigo-500/20 text-indigo-300 text-xs px-1.5 py-0.5 rounded font-medium">
                        <Bot size={10} />
                        BOT
                      </span>
                    )}
                    {showTimestamps !== 'never' && (
                      <span className={`text-fc-muted ${compact ? 'text-[9px]' : 'text-xs'} ${showTimestamps === 'hover' ? 'opacity-0 group-hover:opacity-100 transition' : ''}`}>{formatTs(msg.created_at)}</span>
                    )}
                    {msg.expires_at && <EphemeralBadge expiresAt={msg.expires_at} />}
                  </div>
                )}

                {isEditing ? (
                  <div className="mt-1">
                    <textarea
                      ref={editRef}
                      value={editContent}
                      onChange={e => setEditContent(e.target.value)}
                      onKeyDown={e => handleEditKey(e, msg.id)}
                      rows={Math.min(editContent.split('\n').length + 1, 6)}
                      className="w-full px-3 py-2 bg-fc-input rounded text-white text-sm outline-none focus:ring-2 focus:ring-fc-accent resize-none"
                    />
                    <div className="flex items-center gap-2 mt-1 text-xs text-fc-muted">
                      <span>Entrée pour confirmer · Échap pour annuler</span>
                      <div className="ml-auto flex gap-1">
                        <button onClick={() => confirmEdit(msg.id)} className="flex items-center gap-1 px-2 py-1 bg-fc-green hover:bg-green-500 text-white rounded transition">
                          <Check size={12} /> Enregistrer
                        </button>
                        <button onClick={cancelEdit} className="flex items-center gap-1 px-2 py-1 bg-fc-hover hover:bg-fc-hover/80 text-fc-muted rounded transition">
                          <X size={12} /> Annuler
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    {msg.pinned && (
                      <div className="flex items-center gap-1 mb-1 text-xs text-amber-400/80">
                        <Pin size={10} />
                        <span>Épinglé</span>
                      </div>
                    )}
                    {/* Indicateur de réponse */}
                    {msg.reply_to && (
                      <button
                        className="flex items-center gap-1.5 mb-1 pl-2 border-l-2 border-fc-accent/40 text-xs text-fc-muted hover:text-white transition text-left w-full"
                        onClick={() => jumpToMessage(msg.reply_to!)}
                      >
                        <CornerUpLeft size={10} className="text-fc-accent flex-shrink-0" />
                        {msg.reply_to_username && (
                          <span className="font-semibold text-white/80">{msg.reply_to_username}</span>
                        )}
                        <span className="italic truncate max-w-xs">
                          {msg.reply_to_content
                            ? msg.reply_to_content.slice(0, 80) + (msg.reply_to_content.length > 80 ? '…' : '')
                            : 'Message original supprimé'}
                        </span>
                      </button>
                    )}

                    {/* Indicateur de message forwardé */}
                    {msg.forward_from_id && (
                      <div className="mb-1 pl-3 border-l-2 border-indigo-400/40 bg-indigo-500/5 rounded-r py-1 pr-2">
                        <div className="flex items-center gap-1.5 text-xs text-indigo-300 mb-0.5">
                          <Forward size={10} className="flex-shrink-0" />
                          <span>Transféré de <span className="font-semibold">@{msg.forward_from_username ?? 'inconnu'}</span></span>
                        </div>
                      </div>
                    )}

                    {msg.content && (() => {
                      const sticker = parseStickerMessage(msg.content)
                      if (sticker) {
                        return (
                          <div className="mt-1 inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-fc-accent/10 to-indigo-500/10 border border-fc-accent/20 shadow-sm">
                            <span style={{ fontSize: '4rem', lineHeight: 1 }}>{sticker.emoji}</span>
                          </div>
                        )
                      }
                      return (
                        <div className="text-fc-text text-sm break-words leading-relaxed">
                          {renderMarkdown(msg.content, customEmojiMap)}
                          {msg.edited_at && (
                            <button
                              onClick={() => setEditHistoryMsg({ id: msg.id })}
                              className="text-xs text-fc-muted ml-1.5 hover:text-fc-accent hover:underline transition"
                              title="Voir l'historique des modifications"
                            >
                              (modifié)
                            </button>
                          )}
                          {msg.expires_at && (
                            <span className="ml-2">
                              <EphemeralBadge expiresAt={msg.expires_at} />
                            </span>
                          )}
                          {translations[msg.id] && (
                            <div className="mt-1.5 px-2 py-1.5 bg-fc-accent/10 border-l-2 border-fc-accent rounded text-sm text-fc-text">
                              <span className="text-xs text-fc-accent font-medium mr-1.5">Traduction :</span>
                              {translations[msg.id]}
                              <button
                                onClick={() => setTranslations(prev => { const n = { ...prev }; delete n[msg.id]; return n })}
                                className="ml-2 text-fc-muted hover:text-white text-xs"
                              >
                                ✕
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    })()}

                    {/* Pièces jointes */}
                    {msg.attachments?.map((att: any) => (
                      <div key={att.id} className="mt-1.5">
                        {isImage(att.content_type) ? (
                          <div className="relative inline-block group/img">
                            <img
                              src={att.url}
                              alt={att.filename}
                              loading="lazy"
                              decoding="async"
                              className="max-w-sm max-h-72 rounded object-cover cursor-zoom-in hover:opacity-90 transition shadow"
                              onClick={() => {
                                const imgs = msg.attachments?.filter((a: any) => a.content_type?.startsWith('image/')).map((a: any) => a.url) ?? []
                                if (imgs.length > 0) setLightbox({ images: imgs, index: imgs.indexOf(att.url) })
                              }}
                            />
                            {att.expires_at && (
                              <div className="absolute bottom-1 right-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded flex items-center gap-1">
                                <Clock size={9} />
                                {new Date(att.expires_at) > new Date()
                                  ? `Expire ${format(new Date(att.expires_at), 'dd/MM HH:mm')}`
                                  : 'Expiré'}
                              </div>
                            )}
                          </div>
                        ) : isVideo(att.content_type) ? (
                          <div className="relative max-w-sm">
                            <video
                              src={att.url}
                              controls
                              preload="metadata"
                              className="max-w-full max-h-72 rounded shadow"
                              style={{ background: '#111' }}
                            />
                            {att.expires_at && (
                              <div className="mt-0.5 text-xs text-fc-muted flex items-center gap-1">
                                <Clock size={10} />
                                {new Date(att.expires_at) > new Date()
                                  ? `Expire le ${format(new Date(att.expires_at), 'dd/MM/yyyy HH:mm')}`
                                  : 'Vidéo expirée'}
                              </div>
                            )}
                          </div>
                        ) : (
                          <a
                            href={att.url}
                            download={att.filename}
                            className="flex items-center gap-2 bg-fc-input px-3 py-2 rounded max-w-xs hover:bg-fc-hover transition"
                          >
                            <span className="text-fc-accent text-sm">{att.filename}</span>
                            <span className="text-xs text-fc-muted">{formatBytes(att.size)}</span>
                          </a>
                        )}
                      </div>
                    ))}

                    {/* Sondage attaché au message */}
                    {msg.poll_id && (
                      <PollDisplay
                        pollId={msg.poll_id}
                        serverId={serverId}
                        channelId={channelId}
                      />
                    )}

                    {/* Link preview (1 seule, pas si attachments, pas si sondage, respecte le paramètre utilisateur) */}
                    {linkPreviewEnabled && msg.content && !msg.attachments?.length && !msg.poll_id && (() => {
                      const url = extractFirstUrl(msg.content)
                      return url ? <LinkPreview url={url} /> : null
                    })()}

                    {/* Réactions — Super Reactions */}
                    {msg.reactions?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {msg.reactions.map((r: any) => {
                          const reactionKey = `${msg.id}:${r.emoji}`
                          const isPopping = poppingReaction === reactionKey
                          return (
                            <button
                              key={r.emoji}
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleReaction(msg.id, r.emoji)
                                if (!r.me) {
                                  setPoppingReaction(reactionKey)
                                  setTimeout(() => setPoppingReaction(null), 500)
                                }
                              }}
                              onMouseEnter={e => handleReactionHover(e, msg.id, r.emoji)}
                              onMouseLeave={() => setReactionPopup(null)}
                              className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-all duration-150
                                hover:scale-110 hover:shadow-md
                                ${r.me ? 'bg-fc-accent/20 border-fc-accent text-white' : 'bg-fc-hover border-fc-hover text-fc-muted hover:border-fc-accent'}
                                ${isPopping ? 'animate-bounce' : ''}`}
                              title={`${r.count} ${r.count === 1 ? 'personne a' : 'personnes ont'} réagi`}
                            >
                              {customEmojiMap[r.emoji]
                                ? <img src={customEmojiMap[r.emoji]} alt={r.emoji} loading="lazy" decoding="async" className="w-4 h-4 object-contain" />
                                : <span>{r.emoji}</span>
                              }
                              <span className={`transition-transform duration-150 inline-block ${isPopping || bumped[`${msg.id}:${r.emoji}`] ? 'scale-110' : 'scale-100'}`}>{r.count}</span>
                            </button>
                          )
                        })}
                        {/* Bouton "+" pour ajouter une réaction */}
                        <div className="relative">
                          <button
                            onClick={(e) => { e.stopPropagation(); setReactionPickerFor(reactionPickerFor === msg.id ? null : msg.id); setEmojiPickerFor(null) }}
                            className="flex items-center justify-center w-7 h-[22px] rounded-full text-xs border bg-fc-hover border-fc-hover text-fc-muted hover:border-fc-accent hover:text-white transition-all duration-150"
                            title="Ajouter une réaction"
                          >
                            +
                          </button>
                          {reactionPickerFor === msg.id && (
                            <div
                              className="absolute bottom-full left-0 mb-1 bg-fc-bg border border-fc-hover rounded-lg shadow-xl p-2 flex flex-wrap gap-1 z-50 w-52"
                              onClick={e => e.stopPropagation()}
                            >
                              {REACTION_PICKER_EMOJIS.map(emoji => (
                                <button
                                  key={emoji}
                                  onClick={() => { toggleReaction(msg.id, emoji); setReactionPickerFor(null) }}
                                  className="text-xl hover:scale-125 transition-transform p-1 rounded hover:bg-fc-hover"
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Barre d'actions au survol */}
              {!isEditing && (
                <div className="absolute right-2 top-0 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition
                  flex items-center bg-fc-channel border border-fc-hover rounded shadow-lg px-1 py-0.5 z-10">
                  {/* Emoji picker rapide */}
                  <div className="relative">
                    <button
                      onClick={(e) => { e.stopPropagation(); setEmojiPickerFor(emojiPickerFor === msg.id ? null : msg.id) }}
                      className="p-1.5 text-fc-muted hover:text-white rounded hover:bg-fc-hover transition"
                      title="Réagir"
                    >
                      <SmilePlus size={14} />
                    </button>
                    {emojiPickerFor === msg.id && (
                      <div
                        className="absolute bottom-full right-0 mb-1 bg-fc-bg border border-fc-hover rounded-lg shadow-xl p-2 flex gap-1 z-50"
                        onClick={e => e.stopPropagation()}
                      >
                        {QUICK_EMOJIS.map(emoji => (
                          <button
                            key={emoji}
                            onClick={() => { onAddReaction?.(msg.id, emoji); setEmojiPickerFor(null) }}
                            className="text-xl hover:scale-125 transition-transform p-1 rounded hover:bg-fc-hover"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => saveMessage.mutate({ message_id: msg.id, channel_id: channelId, server_id: serverId })}
                    className="p-1.5 text-fc-muted hover:text-fc-accent rounded hover:bg-fc-hover transition"
                    title="Sauvegarder"
                  >
                    <Bookmark size={14} />
                  </button>

                  <button
                    onClick={() => {
                      const md = msg.content ?? ''
                      navigator.clipboard.writeText(md)
                      toast.success('Copié en Markdown !')
                    }}
                    className="p-1.5 text-fc-muted hover:text-white rounded hover:bg-fc-hover transition"
                    title="Copier en Markdown"
                  >
                    <Copy size={14} />
                  </button>

                  <button
                    onClick={() => {
                      const url = `${window.location.origin}/servers/${serverId}/channels/${channelId}?highlight=${msg.id}`
                      navigator.clipboard.writeText(url)
                      toast.success('Lien copié !')
                    }}
                    className="p-1.5 text-fc-muted hover:text-white rounded hover:bg-fc-hover transition"
                    title="Copier le lien"
                  >
                    <Link size={14} />
                  </button>

                  <button
                    onClick={() => setForwardingMsg({ id: msg.id })}
                    className="p-1.5 text-fc-muted hover:text-white rounded hover:bg-fc-hover transition"
                    title="Transférer"
                  >
                    <Forward size={14} />
                  </button>

                  {onReply && (
                    <button
                      onClick={() => onReply(msg)}
                      className="p-1.5 text-fc-muted hover:text-white rounded hover:bg-fc-hover transition"
                      title="Répondre"
                    >
                      <CornerUpLeft size={14} />
                    </button>
                  )}

                  {onOpenThread && (
                    <button
                      onClick={() => { onOpenThread(msg.id); setEmojiPickerFor(null) }}
                      className="p-1.5 text-fc-muted hover:text-white rounded hover:bg-fc-hover transition"
                      title="Ouvrir thread"
                    >
                      <MessagesSquare size={14} />
                    </button>
                  )}

                  {onPinMessage && (
                    <button
                      onClick={() => onPinMessage(msg.id)}
                      className={`p-1.5 rounded hover:bg-fc-hover transition ${msg.pinned ? 'text-fc-accent' : 'text-fc-muted hover:text-white'}`}
                      title={msg.pinned ? 'Épinglé' : 'Épingler'}
                    >
                      <Pin size={14} />
                    </button>
                  )}

                  {isOwn && (
                    <button
                      onClick={() => startEdit(msg.id, msg.content ?? '')}
                      className="p-1.5 text-fc-muted hover:text-white rounded hover:bg-fc-hover transition"
                      title="Modifier"
                    >
                      <Pencil size={14} />
                    </button>
                  )}

                  <button
                    onClick={() => {
                      if (translations[msg.id]) {
                        setTranslations(prev => { const n = { ...prev }; delete n[msg.id]; return n })
                      } else {
                        translateMessage(msg.id)
                      }
                    }}
                    className={`p-1.5 rounded hover:bg-fc-hover transition ${translations[msg.id] ? 'text-fc-accent' : 'text-fc-muted hover:text-white'}`}
                    title={translations[msg.id] ? 'Masquer la traduction' : 'Traduire en français'}
                    disabled={translatingId === msg.id}
                  >
                    {translatingId === msg.id ? <Loader2 size={14} className="animate-spin" /> : <Languages size={14} />}
                  </button>

                  <div className="relative">
                    <button
                      onClick={() => setReminderFor(reminderFor === msg.id ? null : msg.id)}
                      className="p-1.5 text-fc-muted hover:text-fc-accent rounded hover:bg-fc-hover transition"
                      title="Me rappeler"
                    >
                      <Bell size={14} />
                    </button>
                    {reminderFor === msg.id && (
                      <ReminderModal
                        messageId={msg.id}
                        onClose={() => setReminderFor(null)}
                      />
                    )}
                  </div>

                  {!isOwn && (
                    <button
                      onClick={() => setReportingMsg(msg.id)}
                      className="p-1.5 text-fc-muted hover:text-red-400 rounded hover:bg-fc-hover transition"
                      title="Signaler ce message"
                    >
                      <Flag size={14} />
                    </button>
                  )}

                  <button
                    onClick={() => setDeleteConfirmId(msg.id)}
                    className="p-1.5 text-fc-muted hover:text-red-400 rounded hover:bg-fc-hover transition"
                    title="Supprimer"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
            </div>
          )
        })}

        {/* Indicateur de frappe */}
        {typing && Object.keys(typing).length > 0 && (() => {
          const names = Object.values(typing)
          const label = names.length === 1
            ? `${names[0]} est en train d'écrire...`
            : `${names.slice(0, 2).join(', ')} sont en train d'écrire...`
          return (
            <div className="text-xs text-fc-muted px-2 py-1 flex items-center gap-1.5 h-6">
              <div className="flex gap-0.5 items-center">
                {[0, 150, 300].map(delay => (
                  <span key={delay} className="w-1.5 h-1.5 bg-fc-muted rounded-full animate-bounce" style={{ animationDelay: `${delay}ms` }} />
                ))}
              </div>
              <span>{label}</span>
            </div>
          )
        })()}

        <div ref={bottomRef} />
      </div>

      {/* Bouton scroll to bottom */}
      {showScrollBtn && (
        <button
          onClick={() => { scrollToBottom(); setNewMsgCount(0) }}
          className="absolute bottom-4 right-4 flex items-center gap-1.5 px-3 py-1.5 bg-fc-accent hover:bg-indigo-500 text-white text-xs font-medium rounded-full shadow-lg transition"
        >
          {newMsgCount > 0 && (
            <span className="bg-white text-fc-accent font-bold rounded-full px-1.5 text-[10px] leading-4 min-w-[18px] text-center">
              {newMsgCount > 99 ? '99+' : newMsgCount}
            </span>
          )}
          <ChevronDown size={14} />
          Aller en bas
        </button>
      )}

      {/* Reaction popup */}
      {reactionPopup && (
        <ReactionPopup
          emoji={reactionPopup.emoji}
          users={reactionPopup.users}
          x={reactionPopup.x}
          y={reactionPopup.y}
          onClose={() => setReactionPopup(null)}
        />
      )}

      {/* User popup */}
      {popup && (
        <UserPopup
          userId={popup.userId}
          anchorX={popup.x}
          anchorY={popup.y}
          onClose={() => setPopup(null)}
        />
      )}

      {/* Modal historique des modifications */}
      {editHistoryMsg && (
        <EditHistoryModal
          messageId={editHistoryMsg.id}
          serverId={serverId}
          channelId={channelId}
          onClose={() => setEditHistoryMsg(null)}
        />
      )}

      {/* Modal transfert de message */}
      {forwardingMsg && (
        <ForwardModal
          messageId={forwardingMsg.id}
          sourceChannelId={channelId}
          sourceServerId={serverId}
          onClose={() => setForwardingMsg(null)}
        />
      )}

      {/* Double-click quick emoji popover */}
      {dblClickPopover && (
        <div
          className="fixed z-50"
          style={{ left: Math.max(8, Math.min(dblClickPopover.x - 80, window.innerWidth - 200)), top: Math.max(8, dblClickPopover.y - 48) }}
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center gap-1 bg-fc-bg border border-fc-hover rounded-full shadow-xl px-2 py-1.5">
            {DBLCLICK_EMOJIS.map(emoji => (
              <button
                key={emoji}
                onClick={() => {
                  onAddReaction?.(dblClickPopover.msgId, emoji)
                  setDblClickPopover(null)
                }}
                className="text-xl hover:scale-125 transition-transform p-1 rounded-full hover:bg-fc-hover"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Modal signalement message */}
      {reportingMsg && (
        <ReportModal
          messageId={reportingMsg}
          onClose={() => setReportingMsg(null)}
        />
      )}

      {lightbox && (
        <LightboxModal
          images={lightbox.images}
          initialIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}

      {/* Context menu clic droit */}
      {contextMenu && (
        <div
          className="fixed z-[200] bg-fc-bg border border-fc-hover rounded-xl shadow-2xl py-1 w-52 text-sm overflow-y-auto"
          style={{
            left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 220)),
            top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 420)),
            maxHeight: Math.min(420, window.innerHeight - 16),
          }}
          onClick={e => e.stopPropagation()}
        >
          {contextMenu.msg.content && (
            <button
              onClick={() => { navigator.clipboard.writeText(contextMenu.msg.content); setContextMenu(null) }}
              className="flex items-center gap-2.5 w-full px-3 py-2 hover:bg-fc-hover transition text-fc-text"
            >
              <Copy size={14} /> Copier le texte
            </button>
          )}
          <button
            onClick={() => {
              const link = `${window.location.origin}/servers/${serverId}/channels/${channelId}?highlight=${contextMenu.msg.id}`
              navigator.clipboard.writeText(link)
              toast.success('Lien copié')
              setContextMenu(null)
            }}
            className="flex items-center gap-2.5 w-full px-3 py-2 hover:bg-fc-hover transition text-fc-text"
          >
            <Link size={14} /> Copier le lien
          </button>
          <button
            onClick={() => { navigator.clipboard.writeText(contextMenu.msg.id); setContextMenu(null) }}
            className="flex items-center gap-2.5 w-full px-3 py-2 hover:bg-fc-hover transition text-fc-muted text-xs"
          >
            <Copy size={12} /> Copier l'ID du message
          </button>

          <div className="border-t border-fc-hover my-1" />

          <button
            onClick={() => { onReply?.(contextMenu.msg); setContextMenu(null) }}
            className="flex items-center gap-2.5 w-full px-3 py-2 hover:bg-fc-hover transition text-fc-text"
          >
            <CornerUpLeft size={14} /> Répondre
          </button>

          {onOpenThread && (
            <button
              onClick={() => { onOpenThread(contextMenu.msg.id); setContextMenu(null) }}
              className="flex items-center gap-2.5 w-full px-3 py-2 hover:bg-fc-hover transition text-fc-text"
            >
              <MessagesSquare size={14} /> Créer un fil
            </button>
          )}

          <button
            onClick={() => { setForwardingMsg({ id: contextMenu.msg.id }); setContextMenu(null) }}
            className="flex items-center gap-2.5 w-full px-3 py-2 hover:bg-fc-hover transition text-fc-text"
          >
            <Forward size={14} className="rotate-180" /> Transférer
          </button>

          {onPinMessage && (
            <button
              onClick={() => { onPinMessage(contextMenu.msg.id); setContextMenu(null) }}
              className="flex items-center gap-2.5 w-full px-3 py-2 hover:bg-fc-hover transition text-fc-text"
            >
              <Pin size={14} /> {contextMenu.msg.pinned ? 'Désépingler' : 'Épingler'}
            </button>
          )}

          {(contextMenu.msg.author_id === user?.id || canManageMessages) && (
            <>
              <div className="border-t border-fc-hover my-1" />
              {contextMenu.msg.author_id === user?.id && (
                <button
                  onClick={() => { startEdit(contextMenu.msg.id, contextMenu.msg.content ?? ''); setContextMenu(null) }}
                  className="flex items-center gap-2.5 w-full px-3 py-2 hover:bg-fc-hover transition text-fc-text"
                >
                  <Pencil size={14} /> Modifier
                </button>
              )}
              <button
                onClick={() => { setDeleteConfirmId(contextMenu.msg.id); setContextMenu(null) }}
                className="flex items-center gap-2.5 w-full px-3 py-2 hover:bg-fc-hover transition text-fc-red"
              >
                <Trash2 size={14} /> Supprimer
              </button>
            </>
          )}

          {contextMenu.msg.author_id !== user?.id && (
            <>
              <div className="border-t border-fc-hover my-1" />
              <button
                onClick={() => { setReportingMsg(contextMenu.msg.id); setContextMenu(null) }}
                className="flex items-center gap-2.5 w-full px-3 py-2 hover:bg-fc-hover transition text-fc-red"
              >
                <Flag size={14} /> Signaler
              </button>
            </>
          )}
        </div>
      )}
      {/* Modale confirmation suppression */}
      {deleteConfirmId && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[300] px-4" onClick={() => setDeleteConfirmId(null)}>
          <div className="bg-fc-channel rounded-xl shadow-2xl w-full max-w-[440px] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-fc-hover">
              <h3 className="text-white font-semibold">Supprimer le message</h3>
            </div>
            <div className="px-5 py-4">
              <p className="text-fc-text text-sm">Êtes-vous sûr de vouloir supprimer ce message ? Cette action est irréversible.</p>
            </div>
            <div className="px-5 pb-4 flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-4 py-2 rounded text-sm text-fc-text hover:text-white hover:bg-fc-hover transition"
              >
                Annuler
              </button>
              <button
                onClick={() => { onDeleteMessage(deleteConfirmId); setDeleteConfirmId(null) }}
                className="px-4 py-2 rounded text-sm font-medium bg-fc-red hover:bg-red-500 text-white transition"
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
      {avatarCtxMenu.node}
    </div>
  )
}
