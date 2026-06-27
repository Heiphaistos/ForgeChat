/**
 * DMConversation — zone de chat DM avec :
 *  - Read receipts (accusés de lecture via WS)
 *  - Typing indicator (animation + envoi TYPING debounced)
 *
 * Extrait de DMPage pour garder DMPage < 800 lignes.
 *
 * Note architecture : MessageList et MessageInput ne sont pas modifiés.
 * Le typing est intercepté via un wrapper de onSend + écoute de l'input DOM.
 * Les read receipts sont affichés dans une zone dédiée sous la liste.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { useWs } from '../../store/ws'
import { useAuth } from '../../store/auth'
import { useChat } from '../../store/chat'
import MessageList from './MessageList'
import MessageInput from './MessageInput'
import type { FileWithTtl } from './MessageInput'
import api from '../../api/client'
import toast from 'react-hot-toast'

const EMPTY_MESSAGES: any[] = []

// ─── Types ────────────────────────────────────────────────────────────────────

interface TypingUser {
  user_id: string
  username: string
}

interface ReceiptUser {
  user_id: string
  username: string
  avatar?: string
}

// key = message_id → [ReceiptUser, ...]
type ReceiptMap = Map<string, ReceiptUser[]>

// ─── Typing indicator ─────────────────────────────────────────────────────────

function TypingIndicator({ users }: { users: TypingUser[] }) {
  if (users.length === 0) return <div className="h-5" />

  const label =
    users.length === 1
      ? `${users[0].username} est en train d'écrire...`
      : `${users.map(u => u.username).join(', ')} sont en train d'écrire...`

  return (
    <div className="px-4 py-1 text-xs text-fc-muted flex items-center gap-2 flex-shrink-0 h-5">
      <span className="flex gap-0.5 items-center">
        {[0, 1, 2].map(i => (
          <span
            key={i}
            className="w-1.5 h-1.5 bg-fc-muted rounded-full animate-bounce"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </span>
      <span className="truncate">{label}</span>
    </div>
  )
}

// ─── Read receipt bar (sous la liste, avant l'input) ─────────────────────────

function ReadReceiptBar({
  channelId,
  receipts,
}: {
  channelId: string
  receipts: ReceiptMap
}) {
  const messages = useChat(s => s.messagesByChannel[channelId] ?? EMPTY_MESSAGES)
  if (messages.length === 0 || receipts.size === 0) return null

  const lastWithReceipt = [...messages].reverse().find(m => (receipts.get(m.id)?.length ?? 0) > 0)
  if (!lastWithReceipt) return null

  const readers = receipts.get(lastWithReceipt.id) ?? []
  if (readers.length === 0) return null

  return (
    <div className="flex items-center justify-end gap-0.5 px-4 pb-1 flex-shrink-0">
      {readers.slice(0, 3).map(r => (
        <div
          key={r.user_id}
          className="w-3.5 h-3.5 rounded-full bg-fc-accent overflow-hidden flex-shrink-0 ring-1 ring-fc-bg flex items-center justify-center"
          title={`Lu par ${r.username}`}
        >
          {r.avatar
            ? <img src={r.avatar} alt="" className="w-full h-full object-cover" />
            : <span className="text-[7px] font-bold text-white">{r.username.charAt(0).toUpperCase()}</span>
          }
        </div>
      ))}
      {readers.length > 3 && (
        <span className="text-[10px] text-fc-muted ml-0.5">+{readers.length - 3}</span>
      )}
    </div>
  )
}

// ─── Composant principal ──────────────────────────────────────────────────────

interface Props {
  dmId: string
  partnerName: string
  onSend: (content: string | null, replyTo?: string, files?: FileWithTtl[]) => void
  onLoadMore?: () => Promise<boolean>
}

export default function DMConversation({ dmId, partnerName, onSend, onLoadMore }: Props) {
  const { on, send } = useWs()
  const me = useAuth(s => s.user)

  // --- Read receipts (key = message_id → [user_id]) ---
  const [receipts, setReceipts] = useState<ReceiptMap>(new Map())

  // --- Typing indicator ---
  const typingTimeouts = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([])

  // Debounce envoi TYPING
  const typingDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastTypingSent = useRef(0)

  // --- WS : DM_READ_RECEIPT ---
  useEffect(() => {
    const off = on('DM_READ_RECEIPT', (d: any) => {
      if (d.conversation_id !== dmId) return
      if (d.user_id === me?.id) return
      const user: ReceiptUser = {
        user_id: d.user_id,
        username: d.username ?? d.user_id.slice(0, 4),
        avatar: d.avatar ?? undefined,
      }
      setReceipts(prev => {
        const next = new Map(prev)
        const existing = next.get(d.message_id) ?? []
        if (!existing.find(r => r.user_id === d.user_id)) {
          next.set(d.message_id, [...existing, user])
        }
        return next
      })
    })
    return off
  }, [dmId, me?.id, on])

  // --- WS : TYPING ---
  useEffect(() => {
    const off = on('TYPING', (d: any) => {
      if (d.conversation_id !== dmId) return
      if (d.user_id === me?.id) return

      const userId: string = d.user_id
      const username: string = d.username ?? 'Utilisateur'

      // Réinitialiser le timeout de 3s
      const old = typingTimeouts.current.get(userId)
      if (old) clearTimeout(old)
      const tid = setTimeout(() => {
        typingTimeouts.current.delete(userId)
        setTypingUsers(prev => prev.filter(u => u.user_id !== userId))
      }, 3000)
      typingTimeouts.current.set(userId, tid)

      setTypingUsers(prev => {
        if (prev.find(u => u.user_id === userId)) return prev
        return [...prev, { user_id: userId, username }]
      })
    })
    return off
  }, [dmId, me?.id, on])

  // Cleanup
  useEffect(() => {
    return () => {
      typingTimeouts.current.forEach(t => clearTimeout(t))
      if (typingDebounce.current) clearTimeout(typingDebounce.current)
    }
  }, [])

  // Envoyer DM_READ quand on entre dans la conversation
  const messages = useChat(s => s.messagesByChannel[dmId] ?? EMPTY_MESSAGES)
  const lastMsgId = messages.length > 0 ? messages[messages.length - 1].id : null
  const lastSignaledRef = useRef<string | null>(null)

  useEffect(() => {
    if (!lastMsgId || lastMsgId === lastSignaledRef.current) return
    lastSignaledRef.current = lastMsgId
    send({ type: 'DM_READ', message_id: lastMsgId, conversation_id: dmId })
  }, [lastMsgId, dmId, send])

  // Écoute WS pour les edits/deletes DM
  const { updateMessage, deleteMessage: storeDeleteMessage, addReaction, removeReaction, mergeAttachments } = useChat()
  useEffect(() => {
    const offEdit = on('DM_MESSAGE_UPDATE', (d: any) => {
      if (d.dm_id !== dmId) return
      updateMessage(dmId, d.message_id, { content: d.content, edited_at: d.edited_at })
    })
    const offDelete = on('DM_MESSAGE_DELETE', (d: any) => {
      if (d.dm_id !== dmId) return
      storeDeleteMessage(dmId, d.message_id)
    })
    const offReaction = on('DM_REACTION_TOGGLE', (d: any) => {
      if (d.dm_id !== dmId) return
      const isMe = d.user_id === me?.id
      if (d.added) addReaction(dmId, d.message_id, d.emoji, d.user_id, isMe)
      else removeReaction(dmId, d.message_id, d.emoji, d.user_id, isMe)
    })
    const offAttachment = on('DM_ATTACHMENT_ADDED', (d: any) => {
      if (d.dm_id !== dmId) return
      mergeAttachments(dmId, d.message_id, d.attachments)
    })
    return () => { offEdit(); offDelete(); offReaction(); offAttachment() }
  }, [dmId, on, updateMessage, storeDeleteMessage, addReaction, removeReaction, mergeAttachments, me?.id])

  const handleDeleteMessage = useCallback(async (msgId: string) => {
    try {
      await api.delete(`/dms/${dmId}/messages/${msgId}`)
    } catch {
      toast.error('Impossible de supprimer ce message')
    }
  }, [dmId])

  const handleEditMessage = useCallback(async (msgId: string, content: string) => {
    try {
      await api.patch(`/dms/${dmId}/messages/${msgId}`, { content })
    } catch {
      toast.error('Impossible de modifier ce message')
    }
  }, [dmId])

  const handleAddReaction = useCallback(async (msgId: string, emoji: string) => {
    try {
      await api.put(`/dms/${dmId}/messages/${msgId}/reactions/${encodeURIComponent(emoji)}`)
    } catch {
      toast.error('Impossible d\'ajouter la réaction')
    }
  }, [dmId])

  // Intercepter les frappes via la capture sur le conteneur (bubble depuis MessageInput)
  const handleKeyCapture = useCallback(() => {
    if (typingDebounce.current) clearTimeout(typingDebounce.current)
    typingDebounce.current = setTimeout(() => {
      const now = Date.now()
      if (now - lastTypingSent.current > 2000) {
        lastTypingSent.current = now
        send({ type: 'TYPING', conversation_id: dmId })
      }
    }, 400)
  }, [dmId, send])

  return (
    <div
      className="flex flex-col flex-1 min-h-0"
      onKeyDown={handleKeyCapture}
    >
      <MessageList
        channelId={dmId}
        serverId=""
        onDeleteMessage={handleDeleteMessage}
        onEditMessage={handleEditMessage}
        onAddReaction={handleAddReaction}
        onLoadMore={onLoadMore}
      />
      <ReadReceiptBar channelId={dmId} receipts={receipts} />
      <TypingIndicator users={typingUsers} />
      <MessageInput
        channelId={dmId}
        serverId=""
        placeholder={`Message @${partnerName}`}
        onSend={(content, replyTo, files) => onSend(content || null, replyTo, files)}
      />
    </div>
  )
}
