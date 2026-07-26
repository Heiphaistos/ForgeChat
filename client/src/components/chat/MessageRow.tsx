import { memo, useEffect, useRef, useState } from 'react'
import { Pencil, Trash2, SmilePlus, MessagesSquare, Check, X, Pin, CornerUpLeft, Bot, Clock, Bookmark, Forward, Bell, Languages, Flag, Copy, Link, Loader2 } from 'lucide-react'
import { format } from 'date-fns'
import { renderMarkdown } from '../../utils/markdown'
import ReminderModal from './ReminderModal'
import PollDisplay from './PollDisplay'
import LinkPreview from './LinkPreview'
import { parseStickerMessage } from './StickerPicker'
import { handleMarkdownShortcut, stripMarkdown } from '../../utils/mdShortcuts'
import { REACTION_PICKER_EMOJIS, formatBytes, extractFirstUrl, EphemeralBadge } from './messageListShared'

export interface MessageRowProps {
  msg: any
  isOwn: boolean
  isGrouped: boolean
  isFirstUnread: boolean
  isLiveMsg: boolean
  showDateDivider: boolean
  dateLabel: string
  isHighlighted: boolean
  isEditing: boolean
  compact: boolean
  ultraCompact: boolean
  showTimestamps: string
  formatTs: (dateStr: string) => string
  formatShortTs: (dateStr: string) => string
  customEmojiMap: Record<string, string>
  linkPreviewEnabled: boolean
  serverId: string
  channelId: string
  canManageMessages: boolean

  quickEmojis: string[]
  showEmojiPicker: boolean
  showReactionPicker: boolean
  isReminderOpen: boolean
  translation: string | undefined
  isTranslating: boolean
  poppingEmoji: string | null
  bumpedEmojis: string[]

  onStartEdit: (msgId: string, content: string) => void
  onConfirmEdit: (msgId: string, newContent: string, originalContent: string) => void
  onCancelEdit: () => void
  onOpenUserPopup: (e: React.MouseEvent, userId: string) => void
  onAvatarContextMenu: (e: React.MouseEvent, msg: any) => void
  onDoubleClick: (msgId: string, x: number, y: number) => void
  onContextMenu: (x: number, y: number, msg: any) => void
  onTouchStartRow: (e: React.TouchEvent, msg: any) => void
  onTouchMoveRow: (e: React.TouchEvent) => void
  onTouchEndRow: (e: React.TouchEvent) => void
  onJumpToMessage: (msgId: string) => void
  onOpenEditHistory: (msgId: string) => void
  onOpenLightbox: (images: string[], index: number) => void
  onToggleReaction: (msgId: string, emoji: string) => void
  onToggleEmojiPicker: (msgId: string) => void
  onAddQuickReaction: (msgId: string, emoji: string) => void
  onPickReaction: (msgId: string, emoji: string) => void
  onToggleReactionPicker: (msgId: string) => void
  onReactionHover: (e: React.MouseEvent, msgId: string, emoji: string) => void
  onReactionHoverEnd: () => void
  onReactionTouchStart: (e: React.TouchEvent, msgId: string, emoji: string) => void
  onReactionTouchEnd: () => void
  onSaveMessage: (msgId: string) => void
  onCopyMarkdown: (content: string) => void
  onCopyLink: (msgId: string) => void
  onForward: (msgId: string) => void
  onReply?: (msg: any) => void
  onOpenThread?: (msgId: string) => void
  onPinMessage?: (msgId: string, pinned: boolean) => void
  onToggleTranslation: (msgId: string) => void
  onToggleReminder: (msgId: string) => void
  onReport: (msgId: string) => void
  onDeleteRequest: (msgId: string) => void
}

function MessageRow({
  msg, isOwn, isGrouped, isFirstUnread, isLiveMsg, showDateDivider, dateLabel,
  isHighlighted, isEditing, compact, ultraCompact, showTimestamps, formatTs, formatShortTs,
  customEmojiMap, linkPreviewEnabled, serverId, channelId, canManageMessages,
  quickEmojis, showEmojiPicker, showReactionPicker, isReminderOpen, translation, isTranslating,
  poppingEmoji, bumpedEmojis,
  onStartEdit, onConfirmEdit, onCancelEdit, onOpenUserPopup, onAvatarContextMenu,
  onDoubleClick, onContextMenu, onTouchStartRow, onTouchMoveRow, onTouchEndRow,
  onJumpToMessage, onOpenEditHistory, onOpenLightbox, onToggleReaction, onToggleEmojiPicker,
  onAddQuickReaction, onPickReaction, onToggleReactionPicker, onReactionHover, onReactionHoverEnd,
  onReactionTouchStart, onReactionTouchEnd, onSaveMessage, onCopyMarkdown, onCopyLink,
  onForward, onReply, onOpenThread, onPinMessage, onToggleTranslation, onToggleReminder,
  onReport, onDeleteRequest,
}: MessageRowProps) {
  const isImage = (ct: string) => ct.startsWith('image/')
  const isVideo = (ct: string) => ct.startsWith('video/')

  return (
    <div className={isLiveMsg ? 'msg-enter' : undefined}>
      {showDateDivider && (
        <div className="flex items-center gap-3 my-3 px-2 select-none" role="separator" aria-label={dateLabel} data-date-label={dateLabel}>
          <div className="flex-1 h-px bg-fc-hover/70" />
          <span className="text-[11px] font-semibold text-fc-muted capitalize whitespace-nowrap px-2 py-0.5 rounded-full bg-fc-hover/50">
            {dateLabel}
          </span>
          <div className="flex-1 h-px bg-fc-hover/70" />
        </div>
      )}
      {isFirstUnread && (
        <div className="flex items-center gap-2 my-2 px-2 select-none">
          <div className="flex-1 h-px bg-red-400/60" />
          <span className="text-xs font-semibold text-red-400 uppercase tracking-wide whitespace-nowrap">Nouveaux messages</span>
          <div className="flex-1 h-px bg-red-400/60" />
        </div>
      )}
      <div
        id={`msg-${msg.id}`}
        data-msg-row={msg.id}
        className={`group flex items-start gap-3 px-2 rounded relative transition-colors duration-300
          ${compact ? 'py-0.5' : 'py-1'}
          ${isEditing ? 'bg-fc-hover/50' : isHighlighted ? 'bg-fc-accent/20' : msg.expires_at ? 'bg-red-500/5 border-l-2 border-red-500/30 hover:bg-red-500/8' : 'hover:bg-fc-hover/30'}`}
        onDoubleClick={e => { e.stopPropagation(); onDoubleClick(msg.id, e.clientX, e.clientY) }}
        onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onContextMenu(e.clientX, e.clientY, msg) }}
        onTouchStart={e => onTouchStartRow(e, msg)}
        onTouchMove={onTouchMoveRow}
        onTouchEnd={onTouchEndRow}
      >
        {/* Avatar */}
        {!ultraCompact && (
          <div className={`flex-shrink-0 mt-0.5 ${compact ? 'w-7' : 'w-8 md:w-10'}`}>
            {isGrouped && showTimestamps !== 'never' && (
              <span className="opacity-0 group-hover:opacity-100 transition text-[9px] text-fc-muted font-mono select-none flex items-center justify-center h-full">
                <time dateTime={msg.created_at} title={formatTs(msg.created_at)}>{formatShortTs(msg.created_at)}</time>
              </span>
            )}
            {!isGrouped && (
              <button
                className={`rounded-full bg-fc-accent flex items-center justify-center font-bold text-sm text-white overflow-hidden hover:opacity-80 transition ${compact ? 'w-7 h-7' : 'w-8 h-8 md:w-10 md:h-10'}`}
                onClick={e => onOpenUserPopup(e, msg.author_id)}
                onContextMenu={e => onAvatarContextMenu(e, msg)}
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
                onClick={e => onOpenUserPopup(e, msg.author_id)}
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
                <time dateTime={msg.created_at} className={`text-fc-muted ${compact ? 'text-[9px]' : 'text-xs'} ${showTimestamps === 'hover' ? 'opacity-0 group-hover:opacity-100 transition' : ''}`}>{formatTs(msg.created_at)}</time>
              )}
              {msg.expires_at && <EphemeralBadge expiresAt={msg.expires_at} />}
            </div>
          )}

          {isEditing ? (
            <EditingArea
              initialContent={msg.content ?? ''}
              onConfirm={(newContent) => onConfirmEdit(msg.id, newContent, msg.content ?? '')}
              onCancel={onCancelEdit}
            />
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
                  onClick={() => onJumpToMessage(msg.reply_to)}
                >
                  <CornerUpLeft size={10} className="text-fc-accent flex-shrink-0" />
                  {msg.reply_to_username && (
                    <span className="font-semibold text-white/80">{msg.reply_to_username}</span>
                  )}
                  <span className="italic truncate max-w-xs">
                    {typeof msg.reply_to_content === 'string' && msg.reply_to_content
                      ? stripMarkdown(msg.reply_to_content).slice(0, 80) + (msg.reply_to_content.length > 80 ? '…' : '')
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
                        onClick={() => onOpenEditHistory(msg.id)}
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
                    {translation && (
                      <div className="mt-1.5 px-2 py-1.5 bg-fc-accent/10 border-l-2 border-fc-accent rounded text-sm text-fc-text">
                        <span className="text-xs text-fc-accent font-medium mr-1.5">Traduction :</span>
                        {translation}
                        <button
                          onClick={() => onToggleTranslation(msg.id)}
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
                    <div className="relative inline-block group/img max-w-full">
                      <img
                        src={att.url}
                        alt={att.filename}
                        loading="lazy"
                        decoding="async"
                        className="max-w-full sm:max-w-sm max-h-72 rounded object-cover cursor-zoom-in hover:opacity-90 transition shadow"
                        style={{ opacity: 0, transition: 'opacity 0.25s ease' }}
                        onLoad={e => { e.currentTarget.style.opacity = '1' }}
                        onClick={() => {
                          const imgs = msg.attachments?.filter((a: any) => a.content_type?.startsWith('image/')).map((a: any) => a.url) ?? []
                          if (imgs.length > 0) onOpenLightbox(imgs, imgs.indexOf(att.url))
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
                    <div className="relative max-w-full sm:max-w-sm">
                      <video
                        src={att.url}
                        controls
                        playsInline
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
                      className="flex items-center gap-2 bg-fc-input px-3 py-2 rounded max-w-full sm:max-w-xs hover:bg-fc-hover transition"
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

              {/* Link preview */}
              {linkPreviewEnabled && msg.content && !msg.attachments?.length && !msg.poll_id && (() => {
                const url = extractFirstUrl(msg.content)
                return url ? <LinkPreview url={url} /> : null
              })()}

              {/* Réactions */}
              {msg.reactions?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {msg.reactions?.map((r: any) => {
                    const isPopping = poppingEmoji === r.emoji
                    const isBumped = bumpedEmojis.includes(r.emoji)
                    return (
                      <button
                        key={r.emoji}
                        onClick={(e) => {
                          e.stopPropagation()
                          onToggleReaction(msg.id, r.emoji)
                        }}
                        onMouseEnter={e => onReactionHover(e, msg.id, r.emoji)}
                        onMouseLeave={onReactionHoverEnd}
                        onTouchStart={e => { e.stopPropagation(); onReactionTouchStart(e, msg.id, r.emoji) }}
                        onTouchEnd={onReactionTouchEnd}
                        onTouchMove={onReactionTouchEnd}
                        onTouchCancel={onReactionTouchEnd}
                        className={`flex items-center gap-1 px-2 py-1 md:py-0.5 rounded-full text-xs border transition-all duration-150
                          hover:scale-110 hover:shadow-md
                          ${r.me ? 'bg-fc-accent/20 border-fc-accent text-white' : 'bg-fc-hover border-fc-hover text-fc-muted hover:border-fc-accent'}
                          ${isPopping ? 'animate-bounce' : ''}`}
                        title={`${r.count} ${r.count === 1 ? 'personne a' : 'personnes ont'} réagi`}
                      >
                        {customEmojiMap[r.emoji]
                          ? <img src={customEmojiMap[r.emoji]} alt={r.emoji} loading="lazy" decoding="async" className="w-4 h-4 object-contain" />
                          : <span>{r.emoji}</span>
                        }
                        <span className={`transition-transform duration-150 inline-block ${isPopping || isBumped ? 'scale-110' : 'scale-100'}`}>{r.count}</span>
                      </button>
                    )
                  })}
                  <div className="relative">
                    <button
                      onClick={(e) => { e.stopPropagation(); onToggleReactionPicker(msg.id) }}
                      className="flex items-center justify-center w-7 h-[28px] md:h-[22px] rounded-full text-xs border bg-fc-hover border-fc-hover text-fc-muted hover:border-fc-accent hover:text-white transition-all duration-150"
                      title="Ajouter une réaction"
                    >
                      +
                    </button>
                    {showReactionPicker && (
                      <div
                        className="absolute bottom-full left-0 mb-1 bg-fc-bg border border-fc-hover rounded-lg shadow-xl p-2 flex flex-wrap gap-1 z-50 w-52"
                        onClick={e => e.stopPropagation()}
                      >
                        {REACTION_PICKER_EMOJIS.map(emoji => (
                          <button
                            key={emoji}
                            onClick={() => onPickReaction(msg.id, emoji)}
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
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); onToggleEmojiPicker(msg.id) }}
                className="p-1.5 text-fc-muted hover:text-white rounded hover:bg-fc-hover transition"
                title="Réagir"
                aria-label="Ajouter une réaction"
                aria-expanded={showEmojiPicker}
              >
                <SmilePlus size={14} />
              </button>
              {showEmojiPicker && (
                <div
                  className="absolute bottom-full right-0 mb-1 bg-fc-bg border border-fc-hover rounded-lg shadow-xl p-2 flex gap-1 z-50"
                  onClick={e => e.stopPropagation()}
                >
                  {quickEmojis.map(emoji => (
                    <button
                      key={emoji}
                      onClick={() => onAddQuickReaction(msg.id, emoji)}
                      className="text-xl hover:scale-125 transition-transform p-1 rounded hover:bg-fc-hover"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={() => onSaveMessage(msg.id)}
              className="p-1.5 text-fc-muted hover:text-fc-accent rounded hover:bg-fc-hover transition"
              title="Sauvegarder"
              aria-label="Sauvegarder le message"
            >
              <Bookmark size={14} />
            </button>

            <button
              onClick={() => onCopyMarkdown(msg.content ?? '')}
              className="p-1.5 text-fc-muted hover:text-white rounded hover:bg-fc-hover transition"
              title="Copier en Markdown"
              aria-label="Copier le message en Markdown"
            >
              <Copy size={14} />
            </button>

            <button
              onClick={() => onCopyLink(msg.id)}
              className="p-1.5 text-fc-muted hover:text-white rounded hover:bg-fc-hover transition"
              title="Copier le lien"
              aria-label="Copier le lien du message"
            >
              <Link size={14} />
            </button>

            <button
              onClick={() => onForward(msg.id)}
              className="p-1.5 text-fc-muted hover:text-white rounded hover:bg-fc-hover transition"
              title="Transférer"
              aria-label="Transférer le message"
            >
              <Forward size={14} />
            </button>

            {onReply && (
              <button
                onClick={() => onReply(msg)}
                className="p-1.5 text-fc-muted hover:text-white rounded hover:bg-fc-hover transition"
                title="Répondre"
                aria-label="Répondre au message"
              >
                <CornerUpLeft size={14} />
              </button>
            )}

            {onOpenThread && (
              <button
                onClick={() => onOpenThread(msg.id)}
                className="p-1.5 text-fc-muted hover:text-white rounded hover:bg-fc-hover transition"
                title="Ouvrir thread"
                aria-label="Ouvrir le fil de discussion"
              >
                <MessagesSquare size={14} />
              </button>
            )}

            {onPinMessage && (
              <button
                onClick={() => onPinMessage(msg.id, !!msg.pinned)}
                className={`p-1.5 rounded hover:bg-fc-hover transition ${msg.pinned ? 'text-fc-accent' : 'text-fc-muted hover:text-white'}`}
                title={msg.pinned ? 'Désépingler' : 'Épingler'}
                aria-label={msg.pinned ? 'Désépingler le message' : 'Épingler le message'}
                aria-pressed={msg.pinned}
              >
                <Pin size={14} />
              </button>
            )}

            {isOwn && (
              <button
                onClick={() => onStartEdit(msg.id, msg.content ?? '')}
                className="p-1.5 text-fc-muted hover:text-white rounded hover:bg-fc-hover transition"
                title="Modifier"
                aria-label="Modifier le message"
              >
                <Pencil size={14} />
              </button>
            )}

            <button
              onClick={() => onToggleTranslation(msg.id)}
              className={`p-1.5 rounded hover:bg-fc-hover transition ${translation ? 'text-fc-accent' : 'text-fc-muted hover:text-white'}`}
              title={translation ? 'Masquer la traduction' : 'Traduire en français'}
              aria-label={translation ? 'Masquer la traduction' : 'Traduire le message en français'}
              aria-pressed={!!translation}
              disabled={isTranslating}
            >
              {isTranslating ? <Loader2 size={14} className="animate-spin" /> : <Languages size={14} />}
            </button>

            <div className="relative">
              <button
                onClick={() => onToggleReminder(msg.id)}
                className="p-1.5 text-fc-muted hover:text-fc-accent rounded hover:bg-fc-hover transition"
                title="Me rappeler"
              >
                <Bell size={14} />
              </button>
              {isReminderOpen && (
                <ReminderModal
                  messageId={msg.id}
                  onClose={() => onToggleReminder(msg.id)}
                />
              )}
            </div>

            {/* Signaler = modération SERVEUR (message_reports.server_id NOT NULL,
                consulté par les admins via ServerAdminPage) -- aucun équivalent
                n'existe pour les DM (pas d'équipe de modération sur une conv 1-à-1,
                le mécanisme de sécurité DM est le blocage). Sans ce garde-fou sur
                serverId, le bouton s'affichait aussi en DM et échouait toujours en
                404 côté backend (create_report ne connaît que `messages`+`channels`
                de serveur), même piège que celui déjà corrigé sur les rappels. */}
            {!isOwn && serverId && (
              <button
                onClick={() => onReport(msg.id)}
                className="p-1.5 text-fc-muted hover:text-red-400 rounded hover:bg-fc-hover transition"
                title="Signaler ce message"
                aria-label="Signaler ce message"
              >
                <Flag size={14} />
              </button>
            )}

            <button
              onClick={() => onDeleteRequest(msg.id)}
              className="p-1.5 text-fc-muted hover:text-red-400 rounded hover:bg-fc-hover transition"
              title="Supprimer"
              aria-label="Supprimer le message"
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// Zone d'édition — état de brouillon local, ne remonte au parent qu'à la confirmation.
// Isole la frappe du reste de la liste (avant : chaque caractère tapé re-rendait tous les messages).
function EditingArea({
  initialContent, onConfirm, onCancel,
}: { initialContent: string; onConfirm: (content: string) => void; onCancel: () => void }) {
  const editRef = useRef<HTMLTextAreaElement>(null)
  const [content, setContent] = useState(initialContent)

  // Focus + curseur en fin de texte au montage — reproduit le comportement de l'ancien
  // useEffect([editingId]) qui faisait pareil quand une édition démarrait
  useEffect(() => {
    const el = editRef.current
    if (el) {
      el.focus()
      el.selectionStart = el.selectionEnd = initialContent.length
    }
  }, [])

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (handleMarkdownShortcut(e, content, setContent)) return
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (content.trim()) onConfirm(content.trim()); else onCancel() }
    if (e.key === 'Escape') onCancel()
  }

  return (
    <div className="mt-1">
      <textarea
        ref={editRef}
        value={content}
        onChange={e => setContent(e.target.value)}
        onKeyDown={handleKey}
        rows={Math.min(content.split('\n').length + 1, 6)}
        enterKeyHint="done"
        className="w-full px-3 py-2 bg-fc-input rounded text-white text-sm outline-none focus:ring-2 focus:ring-fc-accent resize-none"
      />
      <div className="flex items-center gap-2 mt-1 text-xs text-fc-muted">
        <span>Entrée pour confirmer · Échap pour annuler</span>
        <div className="ml-auto flex gap-1">
          <button onClick={() => { if (content.trim()) onConfirm(content.trim()); else onCancel() }} className="flex items-center gap-1 px-2 py-1 bg-fc-green hover:bg-green-500 text-white rounded transition">
            <Check size={12} /> Enregistrer
          </button>
          <button onClick={onCancel} className="flex items-center gap-1 px-2 py-1 bg-fc-hover hover:bg-fc-hover/80 text-fc-muted rounded transition">
            <X size={12} /> Annuler
          </button>
        </div>
      </div>
    </div>
  )
}

export default memo(MessageRow)
