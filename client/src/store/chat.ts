import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { EncPayload, MsgBody } from '../e2e/crypto'
import type { E2EState } from '../e2e/conversations'
import { mergeUnlocked } from '../e2e/keysRetry'
import { applyDeletion, editHistory } from '../lib/messageLog'
import { useUxPrefs } from '../lib/uxPrefs'
// Import circulaire (auth importe chat) : useAuth n'est lu que dans les actions, jamais au chargement.
import { useAuth } from './auth'

// ─── Draft Store (localStorage) ───────────────────────────────────────────────

interface DraftState {
  drafts: Record<string, string>
  setDraft: (channelId: string, content: string) => void
  clearDraft: (channelId: string) => void
}

/**
 * Ancien stockage des brouillons EN CLAIR (localStorage `fc-drafts`) : relu une fois puis effacé.
 * Les brouillons vivent désormais en mémoire ; leur copie durable est chiffrée sur le serveur
 * (e2e/drafts.ts, qui envoie aussi ces anciens brouillons au premier chargement).
 */
function legacyDrafts(): Record<string, string> {
  try {
    const raw = localStorage.getItem('fc-drafts')
    localStorage.removeItem('fc-drafts')
    const d: unknown = raw ? JSON.parse(raw)?.state?.drafts : null
    return d && typeof d === 'object'
      ? Object.fromEntries(Object.entries(d).filter((e): e is [string, string] => typeof e[1] === 'string'))
      : {}
  } catch {
    return {}
  }
}

export const useDraft = create<DraftState>()((set, get) => ({
  drafts: legacyDrafts(),
  setDraft: (channelId, content) => set({
    drafts: content.trim()
      ? { ...get().drafts, [channelId]: content }
      : Object.fromEntries(Object.entries(get().drafts).filter(([k]) => k !== channelId)),
  }),
  clearDraft: (channelId) => set({
    drafts: Object.fromEntries(Object.entries(get().drafts).filter(([k]) => k !== channelId)),
  }),
}))

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
  author_avatar_decoration?: string | null
  author_is_bot: boolean
  author_verified?: boolean
  attachments: Attachment[]
  reactions: ReactionCount[]
  poll_id?: string | null
  expires_at?: string | null
  /** Message éphémère « après lecture » (MP, groupe) : échéance posée quand tous l'ont lu. */
  expire_on_read?: boolean
  // Chiffrement de bout en bout (salons) : `content` est le texte déchiffré ici.
  enc?: EncPayload | null
  client_msg_id?: string | null
  purged?: boolean
  /** Envoyé en clair (bot, webhook, système, ancien message, membre sans clé). */
  unencrypted?: boolean
  e2e?: E2EState
  /** Contenu déchiffré complet (aperçu de lien `p`…). */
  e2e_body?: MsgBody
  /** Aperçu de la réponse citée encore illisible. */
  e2e_reply?: 'locked'
  /** Journal local (Extras) : supprimé chez l'auteur, gardé barré en mémoire. */
  logged_deleted?: boolean
  /** Journal local (Extras) : versions précédentes, en mémoire seulement. */
  logged_edits?: string[]
}
export type ChatMessage = Message

interface ReactionCount {
  emoji: string
  count: number
  me: boolean
  /** Super réaction : pastille à part de la réaction normale du même emoji. */
  is_super?: boolean
}

interface ChatState {
  messagesByChannel: Record<string, Message[]>
  typing: Record<string, Record<string, string>>
  addMessages: (channelId: string, messages: Message[], prepend?: boolean) => void
  addMessage: (msg: Message) => void
  updateMessage: (channelId: string, msgId: string, patch: Partial<Message>) => void
  mergeAttachments: (channelId: string, msgId: string, attachments: Attachment[]) => void
  deleteMessage: (channelId: string, msgId: string) => void
  clearChannel: (channelId: string) => void
  updateUserInMessages: (userId: string, username: string, avatar: string | null, decoration: string | null) => void
  setTyping: (channelId: string, userId: string, username: string) => void
  clearTyping: (channelId: string, userId: string) => void
  addReaction: (channelId: string, msgId: string, emoji: string, userId: string, me: boolean, isSuper?: boolean) => void
  removeReaction: (channelId: string, msgId: string, emoji: string, userId: string, wasMe: boolean, isSuper?: boolean) => void
}

export const useChat = create<ChatState>()(
  immer((set) => ({
    messagesByChannel: {},
    typing: {},

    addMessages: (channelId, messages, prepend = false) => set(s => {
      const existing = s.messagesByChannel[channelId] ?? []
      const ids = new Set(existing.map(m => m.id))
      // Rechargé après l'arrivée des clés : la version lisible remplace l'attente.
      const kept = mergeUnlocked(existing, messages)
      const newMsgs = messages.filter(m => !ids.has(m.id))
      const merged = prepend ? [...newMsgs, ...kept] : [...kept, ...newMsgs]
      s.messagesByChannel[channelId] = merged.length > 500 ? (prepend ? merged.slice(0, 500) : merged.slice(merged.length - 500)) : merged
    }),

    addMessage: (msg) => set(s => {
      const ch = s.messagesByChannel[msg.channel_id] ?? []
      if (!ch.find(m => m.id === msg.id)) {
        const next = [...ch, msg]
        s.messagesByChannel[msg.channel_id] = next.length > 500 ? next.slice(next.length - 500) : next
      }
    }),

    updateMessage: (channelId, msgId, patch) => set(s => {
      const msgs = s.messagesByChannel[channelId]
      if (!msgs) return
      const idx = msgs.findIndex(m => m.id === msgId)
      if (idx === -1) return
      // Modification (edited_at) : l'ancien texte va au journal local s'il est actif.
      if ('edited_at' in patch) msgs[idx].logged_edits = editHistory(msgs[idx], patch.content, useUxPrefs.getState().messageLogger)
      Object.assign(msgs[idx], patch)
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
      s.messagesByChannel[channelId] = applyDeletion(msgs, msgId, useUxPrefs.getState().messageLogger, useAuth.getState().user?.id)
    }),

    clearChannel: (channelId) => set(s => {
      s.messagesByChannel[channelId] = []
    }),

    updateUserInMessages: (userId, username, avatar, decoration) => set(s => {
      for (const msgs of Object.values(s.messagesByChannel)) {
        if (!msgs) continue
        for (const msg of msgs) {
          if (msg.author_id === userId) {
            msg.author_username = username
            msg.author_avatar = avatar
            msg.author_avatar_decoration = decoration
          }
        }
      }
    }),

    setTyping: (channelId, userId, username) => set(s => {
      if (!s.typing[channelId]) s.typing[channelId] = {}
      s.typing[channelId][userId] = username
    }),

    clearTyping: (channelId, userId) => set(s => {
      if (s.typing[channelId]) delete s.typing[channelId][userId]
    }),

    addReaction: (channelId, msgId, emoji, _userId, me, isSuper = false) => set(s => {
      const msgs = s.messagesByChannel[channelId]
      if (!msgs) return
      const msg = msgs.find(m => m.id === msgId)
      if (!msg) return
      const r = msg.reactions.find(r => r.emoji === emoji && !!r.is_super === isSuper)
      if (r) { r.count++; if (me) r.me = true }
      else msg.reactions.push({ emoji, count: 1, me, is_super: isSuper })
    }),

    removeReaction: (channelId, msgId, emoji, _userId, wasMe, isSuper = false) => set(s => {
      const msgs = s.messagesByChannel[channelId]
      if (!msgs) return
      const msg = msgs.find(m => m.id === msgId)
      if (!msg) return
      const r = msg.reactions.find(r => r.emoji === emoji && !!r.is_super === isSuper)
      if (r) {
        r.count--
        if (wasMe) r.me = false
        if (r.count <= 0) msg.reactions = msg.reactions.filter(x => x !== r)
      }
    }),
  }))
)
