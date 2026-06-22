import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

export interface Attachment {
  id: string
  url: string
  filename: string
  content_type: string
  size: number
  expires_at?: string | null
}

interface Message {
  id: string
  channel_id: string
  content: string | null
  type: string
  reply_to: string | null
  reply_to_content: string | null
  reply_to_username: string | null
  forward_from_id: string | null
  forward_from_username: string | null
  pinned: boolean
  edited_at: string | null
  created_at: string
  author_id: string
  author_username: string
  author_discriminator: string
  author_avatar: string | null
  author_is_bot: boolean
  attachments: Attachment[]
  reactions: ReactionCount[]
  poll_id?: string | null
}

interface ReactionCount {
  emoji: string
  count: number
  me: boolean
}

interface ChatState {
  messagesByChannel: Record<string, Message[]>
  typing: Record<string, Set<string>>
  addMessages: (channelId: string, messages: Message[], prepend?: boolean) => void
  addMessage: (msg: Message) => void
  updateMessage: (channelId: string, msgId: string, patch: Partial<Message>) => void
  mergeAttachments: (channelId: string, msgId: string, attachments: Attachment[]) => void
  deleteMessage: (channelId: string, msgId: string) => void
  setTyping: (channelId: string, userId: string) => void
  clearTyping: (channelId: string, userId: string) => void
  addReaction: (channelId: string, msgId: string, emoji: string, userId: string, me: boolean) => void
  removeReaction: (channelId: string, msgId: string, emoji: string, userId: string) => void
}

export const useChat = create<ChatState>()(
  immer((set) => ({
    messagesByChannel: {},
    typing: {},

    addMessages: (channelId, messages, prepend = false) => set(s => {
      const existing = s.messagesByChannel[channelId] ?? []
      const ids = new Set(existing.map(m => m.id))
      const newMsgs = messages.filter(m => !ids.has(m.id))
      s.messagesByChannel[channelId] = prepend
        ? [...newMsgs, ...existing]
        : [...existing, ...newMsgs]
    }),

    addMessage: (msg) => set(s => {
      const ch = s.messagesByChannel[msg.channel_id] ?? []
      if (!ch.find(m => m.id === msg.id)) {
        s.messagesByChannel[msg.channel_id] = [...ch, msg]
      }
    }),

    updateMessage: (channelId, msgId, patch) => set(s => {
      const msgs = s.messagesByChannel[channelId]
      if (!msgs) return
      const idx = msgs.findIndex(m => m.id === msgId)
      if (idx !== -1) Object.assign(msgs[idx], patch)
    }),

    mergeAttachments: (channelId, msgId, attachments) => set(s => {
      const msgs = s.messagesByChannel[channelId]
      if (!msgs) return
      const msg = msgs.find(m => m.id === msgId)
      if (!msg) return
      const existingIds = new Set(msg.attachments.map(a => a.id))
      msg.attachments = [...msg.attachments, ...attachments.filter(a => !existingIds.has(a.id))]
    }),

    deleteMessage: (channelId, msgId) => set(s => {
      const msgs = s.messagesByChannel[channelId]
      if (!msgs) return
      s.messagesByChannel[channelId] = msgs.filter(m => m.id !== msgId)
    }),

    setTyping: (channelId, userId) => set(s => {
      if (!s.typing[channelId]) s.typing[channelId] = new Set()
      s.typing[channelId].add(userId)
    }),

    clearTyping: (channelId, userId) => set(s => {
      s.typing[channelId]?.delete(userId)
    }),

    addReaction: (channelId, msgId, emoji, _userId, me) => set(s => {
      const msgs = s.messagesByChannel[channelId]
      if (!msgs) return
      const msg = msgs.find(m => m.id === msgId)
      if (!msg) return
      const r = msg.reactions.find(r => r.emoji === emoji)
      if (r) { r.count++; if (me) r.me = true }
      else msg.reactions.push({ emoji, count: 1, me })
    }),

    removeReaction: (channelId, msgId, emoji, _userId) => set(s => {
      const msgs = s.messagesByChannel[channelId]
      if (!msgs) return
      const msg = msgs.find(m => m.id === msgId)
      if (!msg) return
      const r = msg.reactions.find(r => r.emoji === emoji)
      if (r) {
        r.count--
        r.me = false
        if (r.count <= 0) msg.reactions = msg.reactions.filter(x => x.emoji !== emoji)
      }
    }),
  }))
)
