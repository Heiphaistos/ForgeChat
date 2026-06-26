import { MessagesSquare } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'

interface ThreadItemProps {
  id: string
  title: string
  message_count: number
  unread_count?: number
  last_activity?: string | null
  creator_username?: string
  onSelect: (threadId: string) => void
}

export default function ThreadItem({
  id,
  title,
  message_count,
  unread_count = 0,
  last_activity,
  creator_username,
  onSelect,
}: ThreadItemProps) {
  const relativeTime = last_activity
    ? formatDistanceToNow(new Date(last_activity), { addSuffix: true, locale: fr })
    : null

  return (
    <button
      onClick={() => onSelect(id)}
      className="w-full flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-fc-hover transition text-left group"
    >
      {/* Icône */}
      <div className="w-8 h-8 rounded-lg bg-fc-accent/15 flex items-center justify-center flex-shrink-0 mt-0.5 group-hover:bg-fc-accent/25 transition">
        <MessagesSquare size={14} className="text-fc-accent" />
      </div>

      {/* Contenu */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white truncate flex-1">{title}</span>
          {unread_count > 0 && (
            <span className="flex-shrink-0 text-xs font-bold bg-fc-accent text-white px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
              {unread_count > 99 ? '99+' : unread_count}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-xs text-fc-muted">
            {message_count} message{message_count !== 1 ? 's' : ''}
          </span>
          {creator_username && (
            <>
              <span className="text-xs text-fc-muted/50">·</span>
              <span className="text-xs text-fc-muted truncate">{creator_username}</span>
            </>
          )}
          {relativeTime && (
            <>
              <span className="text-xs text-fc-muted/50">·</span>
              <span className="text-xs text-fc-muted/70 truncate">{relativeTime}</span>
            </>
          )}
        </div>
      </div>
    </button>
  )
}
