import { useEffect, useRef } from 'react'
import { format, isToday, isYesterday } from 'date-fns'
import { fr } from 'date-fns/locale'
import { Pencil, Trash2, SmilePlus, Pin } from 'lucide-react'
import { useAuth } from '../../store/auth'
import { useChat } from '../../store/chat'

interface Props {
  channelId: string
  serverId: string
  onDeleteMessage: (msgId: string) => void
  onEditMessage: (msgId: string, content: string) => void
}

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

export default function MessageList({ channelId, serverId, onDeleteMessage, onEditMessage }: Props) {
  const { user } = useAuth()
  const messages = useChat(s => s.messagesByChannel[channelId] ?? [])
  const typing = useChat(s => s.typing[channelId])
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  return (
    <div className="flex-1 overflow-y-auto px-4 py-2 space-y-0.5">
      {messages.map((msg, i) => {
        const prev = messages[i - 1]
        const isGrouped = prev &&
          prev.author_id === msg.author_id &&
          new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60 * 1000

        const isOwn = msg.author_id === user?.id
        const isImage = (ct: string) => ct.startsWith('image/')

        return (
          <div
            key={msg.id}
            className="group flex items-start gap-3 hover:bg-fc-hover/30 px-2 py-0.5 rounded relative"
          >
            {/* Avatar */}
            <div className="w-10 flex-shrink-0">
              {!isGrouped && (
                <div className="w-10 h-10 rounded-full bg-fc-accent flex items-center justify-center font-bold text-sm text-white">
                  {msg.author_avatar
                    ? <img src={msg.author_avatar} alt="" className="w-full h-full rounded-full object-cover" />
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

              {msg.content && (
                <p className="text-fc-text text-sm break-words">
                  {msg.content}
                  {msg.edited_at && (
                    <span className="text-xs text-fc-muted ml-1">(modifié)</span>
                  )}
                </p>
              )}

              {/* Pièces jointes */}
              {msg.attachments.map(att => (
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
              {msg.reactions.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {msg.reactions.map(r => (
                    <button
                      key={r.emoji}
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
            </div>

            {/* Actions hover */}
            <div className="absolute right-2 top-0 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition
              flex items-center gap-1 bg-fc-channel border border-fc-hover rounded shadow-lg px-1 py-0.5">
              <button className="p-1.5 text-fc-muted hover:text-white rounded hover:bg-fc-hover transition" title="Réagir">
                <SmilePlus size={14} />
              </button>
              {isOwn && (
                <button
                  onClick={() => onEditMessage(msg.id, msg.content ?? '')}
                  className="p-1.5 text-fc-muted hover:text-white rounded hover:bg-fc-hover transition"
                  title="Modifier"
                >
                  <Pencil size={14} />
                </button>
              )}
              <button
                onClick={() => onDeleteMessage(msg.id)}
                className="p-1.5 text-fc-muted hover:text-fc-red rounded hover:bg-fc-hover transition"
                title="Supprimer"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        )
      })}

      {/* Typing indicator */}
      {typing && typing.size > 0 && (
        <div className="text-xs text-fc-muted px-2 py-1 flex items-center gap-1">
          <div className="flex gap-0.5">
            <span className="w-1.5 h-1.5 bg-fc-muted rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 bg-fc-muted rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 bg-fc-muted rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
          quelqu'un est en train d'écrire...
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}
