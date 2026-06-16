import { useEffect, useRef, useState, KeyboardEvent } from 'react'
import { format, isToday, isYesterday } from 'date-fns'
import { fr } from 'date-fns/locale'
import { Pencil, Trash2, SmilePlus, MessagesSquare, Check, X, Pin, CornerUpLeft } from 'lucide-react'
import { useAuth } from '../../store/auth'
import { useChat } from '../../store/chat'
import { renderMarkdown } from '../../utils/markdown'

interface Props {
  channelId: string
  serverId: string
  onDeleteMessage: (msgId: string) => void
  onEditMessage: (msgId: string, content: string) => void
  onOpenThread?: (msgId: string) => void
  onAddReaction?: (msgId: string, emoji: string) => void
  onPinMessage?: (msgId: string) => void
  onReply?: (msg: any) => void
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

export default function MessageList({
  channelId,
  onDeleteMessage,
  onEditMessage,
  onOpenThread,
  onAddReaction,
  onPinMessage,
  onReply,
}: Props) {
  const { user } = useAuth()
  const messages = useChat(s => s.messagesByChannel[channelId] ?? [])
  const typing = useChat(s => s.typing[channelId])
  const bottomRef = useRef<HTMLDivElement>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [emojiPickerFor, setEmojiPickerFor] = useState<string | null>(null)
  const editRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // Focus textarea quand on entre en mode édition
  useEffect(() => {
    if (editingId && editRef.current) {
      editRef.current.focus()
      editRef.current.selectionStart = editContent.length
    }
  }, [editingId])

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

  const cancelEdit = () => {
    setEditingId(null)
    setEditContent('')
  }

  const handleEditKey = (e: KeyboardEvent<HTMLTextAreaElement>, msgId: string) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      confirmEdit(msgId)
    }
    if (e.key === 'Escape') {
      cancelEdit()
    }
  }

  const isImage = (ct: string) => ct.startsWith('image/')

  return (
    <div
      className="flex-1 overflow-y-auto px-4 py-2 space-y-0.5"
      onClick={() => setEmojiPickerFor(null)}
    >
      {messages.map((msg, i) => {
        const prev = messages[i - 1]
        const isGrouped =
          prev &&
          prev.author_id === msg.author_id &&
          new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60 * 1000

        const isOwn = msg.author_id === user?.id
        const isEditing = editingId === msg.id

        return (
          <div
            key={msg.id}
            className={`group flex items-start gap-3 px-2 py-0.5 rounded relative transition
              ${isEditing ? 'bg-fc-hover/50' : 'hover:bg-fc-hover/30'}`}
          >
            {/* Avatar */}
            <div className="w-10 flex-shrink-0 mt-0.5">
              {!isGrouped && (
                <div className="w-10 h-10 rounded-full bg-fc-accent flex items-center justify-center font-bold text-sm text-white overflow-hidden">
                  {msg.author_avatar
                    ? <img src={msg.author_avatar} alt="" className="w-full h-full object-cover" />
                    : msg.author_username.charAt(0).toUpperCase()}
                </div>
              )}
            </div>

            {/* Contenu */}
            <div className="flex-1 min-w-0">
              {!isGrouped && (
                <div className="flex items-baseline gap-2 mb-0.5">
                  <span className="font-semibold text-white text-sm hover:underline cursor-pointer">
                    {msg.author_username}
                  </span>
                  <span className="text-xs text-fc-muted">{formatDate(msg.created_at)}</span>
                </div>
              )}

              {/* Texte ou zone d'édition */}
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
                      <button
                        onClick={() => confirmEdit(msg.id)}
                        className="flex items-center gap-1 px-2 py-1 bg-fc-green hover:bg-green-500 text-white rounded transition"
                      >
                        <Check size={12} /> Enregistrer
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="flex items-center gap-1 px-2 py-1 bg-fc-hover hover:bg-fc-hover/80 text-fc-muted rounded transition"
                      >
                        <X size={12} /> Annuler
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {/* Message de reply référencé */}
                  {msg.reply_to && (
                    <div className="flex items-center gap-1.5 mb-1 pl-2 border-l-2 border-fc-accent/40 text-xs text-fc-muted">
                      <CornerUpLeft size={10} className="text-fc-accent flex-shrink-0" />
                      {msg.reply_to_username && (
                        <span className="font-semibold text-white/80">{msg.reply_to_username}</span>
                      )}
                      <span className="italic truncate max-w-xs">
                        {msg.reply_to_content
                          ? msg.reply_to_content.slice(0, 80) + (msg.reply_to_content.length > 80 ? '…' : '')
                          : 'Message original supprimé'}
                      </span>
                    </div>
                  )}

                  {msg.content && (
                    <div className="text-fc-text text-sm break-words leading-relaxed">
                      {renderMarkdown(msg.content)}
                      {msg.edited_at && (
                        <span className="text-xs text-fc-muted ml-1.5">(modifié)</span>
                      )}
                    </div>
                  )}

                  {/* Pièces jointes */}
                  {msg.attachments?.map((att: any) => (
                    <div key={att.id} className="mt-1">
                      {isImage(att.content_type) ? (
                        <img
                          src={att.url}
                          alt={att.filename}
                          className="max-w-sm max-h-72 rounded object-cover cursor-pointer hover:opacity-90 transition"
                          onClick={() => window.open(att.url, '_blank')}
                        />
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

                  {/* Réactions */}
                  {msg.reactions?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {msg.reactions.map((r: any) => (
                        <button
                          key={r.emoji}
                          onClick={() => onAddReaction?.(msg.id, r.emoji)}
                          className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition
                            ${r.me
                              ? 'bg-fc-accent/20 border-fc-accent text-white'
                              : 'bg-fc-hover border-fc-hover text-fc-muted hover:border-fc-accent'}`}
                        >
                          <span>{r.emoji}</span>
                          <span>{r.count}</span>
                        </button>
                      ))}
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
                          onClick={() => {
                            onAddReaction?.(msg.id, emoji)
                            setEmojiPickerFor(null)
                          }}
                          className="text-xl hover:scale-125 transition-transform p-1 rounded hover:bg-fc-hover"
                          title={emoji}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

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
              <span
                key={delay}
                className="w-1.5 h-1.5 bg-fc-muted rounded-full animate-bounce"
                style={{ animationDelay: `${delay}ms` }}
              />
            ))}
          </div>
          <span>quelqu'un est en train d'écrire...</span>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}
