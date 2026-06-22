import { useEffect, useRef, useState, useCallback, KeyboardEvent, useMemo } from 'react'
import { format, isToday, isYesterday } from 'date-fns'
import { fr } from 'date-fns/locale'
import { Pencil, Trash2, SmilePlus, MessagesSquare, Check, X, Pin, CornerUpLeft, ChevronDown, Loader2, Bot, Clock, Bookmark, Forward } from 'lucide-react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useAuth } from '../../store/auth'
import { useChat } from '../../store/chat'
import { renderMarkdown } from '../../utils/markdown'
import UserPopup from '../UserPopup'
import ReactionPopup from './ReactionPopup'
import LinkPreview from './LinkPreview'
import EditHistoryModal from './EditHistoryModal'
import ForwardModal from './ForwardModal'
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
}

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉', '🔥', '👀']

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
}: Props) {
  const { user } = useAuth()

  const { data: customEmojisList = [] } = useQuery<{ name: string; url: string }[]>({
    queryKey: ['custom_emojis', serverId],
    queryFn: () => api.get(`/servers/${serverId}/emojis`).then(r => r.data),
    enabled: !!serverId,
    staleTime: 60_000,
  })

  const customEmojiMap = useMemo(() =>
    Object.fromEntries(customEmojisList.map(e => [e.name, e.url])),
    [customEmojisList]
  )
  const messages = useChat(s => s.messagesByChannel[channelId] ?? [])
  const typing = useChat(s => s.typing[channelId])
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const msgRefs = useRef<Record<string, HTMLDivElement>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [emojiPickerFor, setEmojiPickerFor] = useState<string | null>(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [popup, setPopup] = useState<PopupState | null>(null)
  const [editHistoryMsg, setEditHistoryMsg] = useState<{ id: string } | null>(null)
  const editRef = useRef<HTMLTextAreaElement>(null)
  const isAtBottom = useRef(true)

  useEffect(() => {
    if (isAtBottom.current) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

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

    // Load more quand on touche le haut
    if (el.scrollTop < 80 && !loadingMore && onLoadMore) {
      setLoadingMore(true)
      const prevHeight = el.scrollHeight
      const hasMore = await onLoadMore()
      setLoadingMore(false)
      if (hasMore) {
        // Maintenir la position de scroll après chargement
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight - prevHeight
        })
      }
    }
  }, [loadingMore, onLoadMore])

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
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [poppingReaction, setPoppingReaction] = useState<string | null>(null)
  const [forwardingMsg, setForwardingMsg] = useState<{ id: string } | null>(null)
  const isImage = (ct: string) => ct.startsWith('image/')
  const isVideo = (ct: string) => ct.startsWith('video/')

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

  return (
    <div className="flex-1 relative flex flex-col overflow-hidden">
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto px-4 py-2 space-y-0.5"
        onClick={() => { setEmojiPickerFor(null); setPopup(null) }}
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
            new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60 * 1000

          const isOwn = msg.author_id === user?.id
          const isEditing = editingId === msg.id
          const isHighlighted = highlightId === msg.id

          return (
            <div
              key={msg.id}
              ref={el => { if (el) msgRefs.current[msg.id] = el }}
              className={`group flex items-start gap-3 px-2 py-0.5 rounded relative transition-colors duration-300
                ${isEditing ? 'bg-fc-hover/50' : isHighlighted ? 'bg-fc-accent/20' : 'hover:bg-fc-hover/30'}`}
            >
              {/* Avatar */}
              <div className="w-10 flex-shrink-0 mt-0.5">
                {!isGrouped && (
                  <button
                    className="w-10 h-10 rounded-full bg-fc-accent flex items-center justify-center font-bold text-sm text-white overflow-hidden hover:opacity-80 transition"
                    onClick={e => openUserPopup(e, msg.author_id)}
                    title={`Profil de ${msg.author_username}`}
                  >
                    {msg.author_avatar
                      ? <img src={msg.author_avatar} alt="" className="w-full h-full object-cover" />
                      : msg.author_username.charAt(0).toUpperCase()}
                  </button>
                )}
              </div>

              {/* Contenu */}
              <div className="flex-1 min-w-0">
                {!isGrouped && (
                  <div className="flex items-baseline gap-2 mb-0.5">
                    <button
                      className="font-semibold text-white text-sm hover:underline cursor-pointer"
                      onClick={e => openUserPopup(e, msg.author_id)}
                    >
                      {msg.author_username}
                    </button>
                    {msg.author_is_bot && (
                      <span className="inline-flex items-center gap-0.5 bg-indigo-500/20 text-indigo-300 text-xs px-1.5 py-0.5 rounded font-medium">
                        <Bot size={10} />
                        BOT
                      </span>
                    )}
                    <span className="text-xs text-fc-muted">{formatDate(msg.created_at)}</span>
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
                              className="max-w-sm max-h-72 rounded object-cover cursor-zoom-in hover:opacity-90 transition shadow"
                              onClick={() => setLightbox(att.url)}
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

                    {/* Link preview (1 seule, pas si attachments, pas si sondage) */}
                    {msg.content && !msg.attachments?.length && !msg.poll_id && (() => {
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
                              onClick={() => {
                                onAddReaction?.(msg.id, r.emoji)
                                // Animation pop
                                setPoppingReaction(reactionKey)
                                setTimeout(() => setPoppingReaction(null), 300)
                              }}
                              onMouseEnter={e => handleReactionHover(e, msg.id, r.emoji)}
                              onMouseLeave={() => setReactionPopup(null)}
                              className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-all duration-150
                                hover:scale-110 hover:shadow-md
                                ${r.me ? 'bg-fc-accent/20 border-fc-accent text-white' : 'bg-fc-hover border-fc-hover text-fc-muted hover:border-fc-accent'}
                                ${isPopping ? 'reaction-pop' : ''}`}
                              title={`${r.count} ${r.count === 1 ? 'personne a' : 'personnes ont'} réagi`}
                            >
                              <span>{r.emoji}</span>
                              <span>{r.count}</span>
                            </button>
                          )
                        })}
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
                    onClick={() => onDeleteMessage(msg.id)}
                    className="p-1.5 text-fc-muted hover:text-red-400 rounded hover:bg-fc-hover transition"
                    title="Supprimer"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          )
        })}

        {/* Indicateur de frappe */}
        {typing && typing.size > 0 && (
          <div className="text-xs text-fc-muted px-2 py-1 flex items-center gap-1.5 h-6">
            <div className="flex gap-0.5 items-center">
              {[0, 150, 300].map(delay => (
                <span key={delay} className="w-1.5 h-1.5 bg-fc-muted rounded-full animate-bounce" style={{ animationDelay: `${delay}ms` }} />
              ))}
            </div>
            <span>quelqu'un est en train d'écrire...</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Bouton scroll to bottom */}
      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 flex items-center gap-1.5 px-3 py-1.5 bg-fc-accent hover:bg-indigo-500 text-white text-xs font-medium rounded-full shadow-lg transition"
        >
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

      {/* Lightbox image plein écran */}
      {lightbox && (
        <div
          className="fixed inset-0 bg-black/90 flex items-center justify-center z-[100] cursor-zoom-out"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox}
            alt=""
            className="max-w-[90vw] max-h-[90vh] object-contain rounded shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
          <button
            className="absolute top-4 right-4 text-white bg-black/50 p-2 rounded-full hover:bg-black/80 transition"
            onClick={() => setLightbox(null)}
          >
            <X size={20} />
          </button>
        </div>
      )}
    </div>
  )
}
