import { useState, useEffect, useRef } from 'react'
import { useSwipeRightToClose } from '../../hooks/useSwipeClose'
import { X, Hash, Send, MessagesSquare, Pencil, Trash2, Check, Paperclip, Loader2, SmilePlus, Archive, ArchiveRestore, Lock } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../../api/client'
import { useAuth } from '../../store/auth'
import { useWs } from '../../store/ws'
import { useFormatDate } from '../../hooks/useFormatDate'
import MediaContent, { useMediaUpload } from './MediaContent'
import EmojiPicker from './EmojiPicker'
import LinkPreview, { extractFirstUrl } from './LinkPreview'
import { handleMarkdownShortcut } from '../../utils/mdShortcuts'
import { useEscapePanel } from '../../hooks/useEscapeKey'
import UserPopup from '../UserPopup'
import { isToday, isYesterday, format } from 'date-fns'
import { fr } from 'date-fns/locale'
import toast from 'react-hot-toast'

interface Props {
  serverId: string
  channelId: string
  parentMessageId: string
  onClose: () => void
}

// Brouillons par message parent — module-level, survivent à la fermeture du fil
const threadDrafts = new Map<string, string>()

export default function ThreadPanel({ serverId, channelId, parentMessageId, onClose }: Props) {
  const { user } = useAuth()
  const { on, send } = useWs()
  const { formatShort } = useFormatDate()
  const [input, setInput] = useState(() => threadDrafts.get(parentMessageId) ?? '')
  // Brouillon conservé si on ferme/rouvre le fil (purgé à l'envoi via setInput(''))
  useEffect(() => {
    if (input.trim()) threadDrafts.set(parentMessageId, input)
    else threadDrafts.delete(parentMessageId)
  }, [input, parentMessageId])
  const mediaUpload = useMediaUpload(serverId, channelId)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  // Pastille de date flottante affichée pendant le scroll (parité canaux/groupes)
  const [floatingDate, setFloatingDate] = useState<string | null>(null)
  const floatingDateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const openTime = useRef(Date.now())
  useEffect(() => { openTime.current = Date.now() }, [parentMessageId])
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
  const linkPreviewEnabled = (userSettings?.link_preview ?? true) as boolean

  const { data: threads = [], isLoading } = useQuery<any[]>({
    queryKey: ['threads', channelId],
    queryFn: () => api.get(`/servers/${serverId}/channels/${channelId}/threads`).then(r => r.data),
  })

  const thread = threads.find((t: any) => t.parent_message_id === parentMessageId)

  useEffect(() => {
    if (thread) setThreadId(thread.id)
  }, [thread?.id])

  const { data: messages = [] } = useQuery<any[]>({
    queryKey: ['thread-messages', threadId],
    queryFn: () => api.get(`/servers/${serverId}/channels/${channelId}/threads/${threadId}/messages`).then(r => r.data),
    enabled: !!threadId,
  })

  // Temps réel — écouter les nouveaux messages du thread via WS
  useEffect(() => {
    if (!threadId) return
    const offMsg = on('THREAD_MESSAGE', (d: any) => {
      if (d.thread_id === threadId || d.parent_id === parentMessageId) {
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
    return () => { offMsg(); offUpdate(); offEdit(); offDelete(); offReact(); offTyping() }
  }, [threadId, parentMessageId, channelId, on, qc])

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
    onError: () => toast.error('Impossible de réagir'),
  })

  const editMessage = useMutation({
    mutationFn: ({ msgId, content }: { msgId: string; content: string }) =>
      api.patch(`/servers/${serverId}/channels/${channelId}/threads/${threadId}/messages/${msgId}`, { content }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['thread-messages', threadId] })
      setEditingMsgId(null)
      toast.success('Message modifié')
    },
    onError: () => toast.error('Impossible de modifier'),
  })

  const deleteMessage = useMutation({
    mutationFn: (msgId: string) =>
      api.delete(`/servers/${serverId}/channels/${channelId}/threads/${threadId}/messages/${msgId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['thread-messages', threadId] })
      toast.success('Message supprimé')
    },
    onError: () => toast.error('Impossible de supprimer'),
  })

  // Scroll to bottom quand les messages changent
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const createThread = useMutation({
    mutationFn: () => api.post(`/servers/${serverId}/channels/${channelId}/threads`, {
      title: newTitle.trim() || undefined,
      first_message: input.trim(),
      parent_message_id: parentMessageId,
    }),
    onSuccess: (res) => {
      const tid = res.data.thread?.id
      if (tid) setThreadId(tid)
      qc.invalidateQueries({ queryKey: ['threads', channelId] })
      setInput('')
      setNewTitle('')
      setCreating(false)
      toast.success('Thread créé !')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const sendMessage = useMutation({
    mutationFn: () => api.post(`/servers/${serverId}/channels/${channelId}/threads/${threadId}/messages`, {
      content: input.trim(),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['thread-messages', threadId] })
      setInput('')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  // archive_thread (threads.rs) impose déjà côté serveur qu'un fil archivé/verrouillé
  // refuse tout nouveau message (403) -- mais aucune UI n'a jamais existé pour
  // basculer cet état : PATCH /threads/:id existait sans le moindre appelant.
  const toggleArchive = useMutation({
    mutationFn: () =>
      api.patch(`/servers/${serverId}/channels/${channelId}/threads/${threadId}`, {
        archived: !thread?.archived,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['threads', channelId] })
      toast.success(thread?.archived ? 'Fil désarchivé' : 'Fil archivé')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const isLocked = !!thread?.locked || !!thread?.archived

  const handleSend = () => {
    if (!input.trim()) return
    // Limite serveur : 4000 caractères
    if (input.trim().length > 4000) {
      toast.error(`Message trop long : ${input.trim().length}/4000 caractères`)
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
      aria-label="Fil de discussion"
      className="absolute inset-0 z-10 md:relative md:inset-auto md:z-auto md:w-80 bg-fc-channel border-l border-fc-bg flex flex-col flex-shrink-0 panel-slide-right"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-3 border-b border-fc-bg flex-shrink-0">
        <MessagesSquare size={16} className="text-fc-muted" aria-hidden />
        <span className="font-semibold text-white text-sm flex-1">Fil de discussion</span>
        <button onClick={onClose} className="text-fc-muted hover:text-white transition p-1 rounded hover:bg-fc-hover" title="Fermer" aria-label="Fermer le fil de discussion">
          <X size={16} />
        </button>
      </div>

      {/* Créer thread */}
      {!threadId && !isLoading && (
        <div className="p-3 border-b border-fc-bg bg-fc-bg/30">
          {!creating ? (
            <button
              onClick={() => setCreating(true)}
              className="w-full text-center text-sm text-fc-accent hover:text-indigo-400 transition py-2"
            >
              + Créer un thread depuis ce message
            </button>
          ) : (
            <div className="space-y-2">
              <input
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="Titre du thread (optionnel)"
                enterKeyHint="next"
                autoCapitalize="sentences"
                className="w-full px-2 py-1.5 bg-fc-input rounded text-sm text-white outline-none focus:ring-1 focus:ring-fc-accent"
              />
              <div className="text-xs text-fc-muted">Ou écrivez directement votre premier message ci-dessous</div>
            </div>
          )}
        </div>
      )}

      {/* Thread existant — infos */}
      {thread && (
        <div className="p-3 border-b border-fc-bg bg-fc-accent/5">
          <div className="flex items-center gap-1.5">
            <Hash size={13} className="text-fc-accent" />
            <span className="text-sm font-medium text-white truncate flex-1">{thread.title}</span>
            {thread.locked && <Lock size={12} className="text-fc-muted flex-shrink-0" aria-label="Fil verrouillé" />}
            <button
              onClick={() => toggleArchive.mutate()}
              disabled={toggleArchive.isPending}
              title={thread.archived ? 'Désarchiver le fil' : 'Archiver le fil'}
              aria-label={thread.archived ? 'Désarchiver le fil' : 'Archiver le fil'}
              className="p-1 text-fc-muted hover:text-fc-accent rounded hover:bg-fc-hover transition disabled:opacity-50 flex-shrink-0"
            >
              {thread.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
            </button>
          </div>
          <div className="text-xs text-fc-muted mt-0.5">
            par {thread.creator_username} · {thread.message_count} messages
          </div>
          {thread.archived && (
            <p className="text-xs text-fc-muted/80 mt-1 italic">Fil archivé — lecture seule.</p>
          )}
        </div>
      )}

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto overscroll-contain p-3 space-y-3"
        onScroll={e => {
          // Pastille de date flottante : jour du dernier séparateur passé au-dessus
          // du viewport (ignoré pendant le scroll initial programmatique)
          if (Date.now() - openTime.current < 800) return
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
            <p>Pas encore de thread</p>
          </div>
        )}

        {threadId && !isLoading && messages.length === 0 && (
          <div className="text-center text-fc-muted text-sm py-8">
            <MessagesSquare size={32} className="mx-auto mb-2 opacity-30" />
            <p>Aucune réponse — soyez le premier !</p>
          </div>
        )}

        {messages.map((msg: any, i: number) => {
          const isMe = msg.author_id === user?.id || msg.user_id === user?.id
          const prev: any = messages[i - 1]
          const msgDate = new Date(msg.created_at)
          const showDateDivider = !prev || new Date(prev.created_at).toDateString() !== msgDate.toDateString()
          const dateLabel = isToday(msgDate) ? "Aujourd'hui"
            : isYesterday(msgDate) ? 'Hier'
            : format(msgDate, 'EEEE d MMMM yyyy', { locale: fr })
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
                  if (uid) setUserPopup({ userId: uid, x: e.clientX, y: e.clientY })
                }}
                aria-label={`Voir le profil de ${msg.author?.username ?? msg.author_username ?? 'l\'auteur'}`}
                className="w-6 h-6 rounded-full bg-fc-accent flex items-center justify-center text-xs font-bold text-white flex-shrink-0 mt-0.5 overflow-hidden hover:ring-2 hover:ring-fc-accent/60 transition cursor-pointer"
              >
                {msg.author?.avatar
                  ? <img src={msg.author.avatar} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
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
                    <span className="text-[9px] text-fc-muted/60" title="Message modifié">(modifié)</span>
                  )}
                  {editingMsgId !== msg.id && (
                    <button
                      onClick={() => setReactionPickerFor(cur => cur === msg.id ? null : msg.id)}
                      className={`opacity-100 md:opacity-0 md:group-hover:opacity-100 p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded transition ${isMe ? '' : 'ml-auto'} ${reactionPickerFor === msg.id ? 'text-fc-accent' : 'text-fc-muted hover:text-white'}`}
                      title="Réagir"
                      aria-label="Réagir au message"
                    ><SmilePlus size={12} aria-hidden /></button>
                  )}
                  {isMe && editingMsgId !== msg.id && (
                    <div className="opacity-100 md:opacity-0 md:group-hover:opacity-100 flex items-center gap-0.5 transition">
                      <button
                        onClick={() => { setEditingMsgId(msg.id); setEditContent(msg.content) }}
                        className="p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-fc-muted hover:text-white rounded transition"
                        title="Modifier"
                        aria-label="Modifier"
                      ><Pencil size={12} /></button>
                      <button
                        onClick={() => deleteMessage.mutate(msg.id)}
                        className="p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-fc-muted hover:text-red-400 rounded transition"
                        title="Supprimer"
                        aria-label="Supprimer"
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
                    <MediaContent text={msg.content ?? ''} className="text-sm text-fc-text leading-relaxed break-words" />
                    {linkPreviewEnabled && msg.content && (() => {
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
                            aria-label={`${r.emoji} ${r.count} réaction${r.count > 1 ? 's' : ''}${r.users?.length ? ' — ' + r.users.join(', ') : ''}`}
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
            {thread?.archived ? 'Ce fil est archivé.' : 'Ce fil est verrouillé.'}
          </p>
        ) : (
        <>
        {Object.keys(typingUsers).length > 0 && (
          <div role="status" aria-live="polite" className="text-[11px] text-fc-muted italic mb-1 px-1 truncate">
            {Object.values(typingUsers).map(t => t.username).join(', ')} {Object.keys(typingUsers).length > 1 ? 'écrivent' : 'écrit'}…
          </div>
        )}
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
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            onPaste={e => mediaUpload.onPaste(e, url => setInput(c => (c ? c + '\n' : '') + url))}
            onDrop={e => mediaUpload.onDrop(e, url => setInput(c => (c ? c + '\n' : '') + url))}
            onDragOver={mediaUpload.onDragOver}
            placeholder={threadId ? 'Répondre au fil...' : 'Premier message du thread...'}
            enterKeyHint="send"
            autoCapitalize="sentences"
            rows={2}
            className="flex-1 px-2.5 py-2 bg-fc-input rounded-lg text-sm text-white outline-none focus:ring-1 focus:ring-fc-accent resize-none"
          />
          <button
            type="button"
            onClick={() => mediaUpload.pick(url => setInput(c => (c ? c + '\n' : '') + url))}
            disabled={mediaUpload.uploading}
            title="Joindre une image ou vidéo"
            aria-label="Joindre une image ou vidéo"
            className="p-2 text-fc-muted hover:text-white rounded-lg hover:bg-fc-hover transition disabled:opacity-50 flex-shrink-0"
          >
            {mediaUpload.uploading ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Paperclip size={16} aria-hidden />}
          </button>
          <button
            onClick={handleSend}
            disabled={!input.trim() || createThread.isPending || sendMessage.isPending}
            className="p-2 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg transition disabled:opacity-50 flex-shrink-0"
            title="Envoyer"
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
          anchorX={userPopup.x}
          anchorY={userPopup.y}
          onClose={() => setUserPopup(null)}
        />
      )}
    </div>
  )
}
