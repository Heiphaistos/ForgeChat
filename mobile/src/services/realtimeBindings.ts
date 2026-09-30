import { usersApi } from '@/api/users'
import {
  appendMessage,
  applyReactionDelta,
  applyReactionToggle,
  mergeAttachments,
  patchMessage,
  removeMessage,
} from '@/features/chat/cache'
import { fromDmMessage, fromGroupMessage, fromServerMessage } from '@/features/chat/adapters'
import { logger } from '@/lib/logger'
import { qk, queryClient } from '@/lib/queryClient'
import { realtime, type RealtimeEvent } from '@/lib/realtime'
import { getMyId, useAuth } from '@/stores/auth'
import { usePresence } from '@/stores/presence'
import { useTyping } from '@/stores/typing'
import { useUnread } from '@/stores/unread'
import type {
  Attachment,
  ConversationSummary,
  DmMessage,
  GroupMessage,
  ServerMessage,
} from '@/types/models'

/**
 * Traduit les événements WebSocket du serveur en mises à jour du cache
 * (TanStack Query) et des stores. Toute donnée entrante est traitée comme non
 * fiable : on vérifie le type des champs utilisés avant de toucher au cache.
 */

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 && v.length < 200 ? v : null)
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const atts = (v: unknown): Attachment[] => (Array.isArray(v) ? (v.filter(isObj) as unknown as Attachment[]) : [])

function touchConversation(id: string, content: string | null, at: string, author?: string) {
  const list = queryClient.getQueryData<ConversationSummary[]>(qk.conversations)
  if (!list || !list.some((c) => c.id === id)) {
    void queryClient.invalidateQueries({ queryKey: qk.conversations })
    return
  }
  const updated = list.map((c) =>
    c.id === id
      ? {
          ...c,
          last_message_at: at,
          last_message_content: content ? content.slice(0, 80) : c.last_message_content,
          ...(c.is_group && author ? { last_message_author: author } : {}),
        }
      : c,
  )
  updated.sort((a, b) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''))
  queryClient.setQueryData(qk.conversations, updated)
}

export function bindRealtime(): () => void {
  const offs: (() => void)[] = []
  const on = (type: string, fn: (e: RealtimeEvent) => void) => offs.push(realtime.on(type, fn))

  // ── Reconnexion : resynchroniser ce qui a pu être manqué ──────────────────
  offs.push(
    realtime.onOpen(() => {
      void queryClient.invalidateQueries({ queryKey: ['messages'] })
      void queryClient.invalidateQueries({ queryKey: qk.conversations })
      void usersApi
        .unread()
        .then((items) => useUnread.getState().load(items))
        .catch((e) => logger.warn('rt', 'unread', e))
    }),
  )

  // ── Présence ───────────────────────────────────────────────────────────────
  on('PRESENCE_INIT', (e) => {
    if (!Array.isArray(e.users)) return
    usePresence.getState().bulk(
      e.users.filter(isObj).flatMap((u) => {
        const id = str(u.user_id)
        const st = str(u.status)
        return id && st ? [{ user_id: id, status: st }] : []
      }),
    )
  })
  on('PRESENCE_UPDATE', (e) => {
    const id = str(e.user_id)
    const st = str(e.status)
    if (id && st) usePresence.getState().set(id, st)
  })

  // ── Salons de serveur ──────────────────────────────────────────────────────
  on('MESSAGE_CREATE', (e) => {
    if (!isObj(e.message)) return
    const raw = e.message as unknown as ServerMessage
    const channelId = str(raw.channel_id)
    if (!channelId || !str(raw.id)) return
    const msg = { ...fromServerMessage(raw), awaitingAttachments: e.pending_attachments === true }
    appendMessage('channel', channelId, msg)
    if (msg.authorId !== getMyId()) useUnread.getState().increment(channelId, str(e.server_id))
    useTyping.getState().remove(channelId, msg.authorId)
  })
  on('MESSAGE_UPDATE', (e) => {
    const cid = str(e.channel_id)
    const mid = str(e.message_id)
    if (!cid || !mid) return
    patchMessage('channel', cid, mid, (m) => ({
      ...m,
      content: typeof e.content === 'string' ? e.content : m.content,
      editedAt: str(e.edited_at) ?? new Date().toISOString(),
    }))
  })
  on('MESSAGE_DELETE', (e) => {
    const cid = str(e.channel_id)
    const mid = str(e.message_id)
    if (cid && mid) removeMessage('channel', cid, mid)
  })
  on('REACTION_ADD', (e) => {
    const cid = str(e.channel_id), mid = str(e.message_id), emoji = str(e.emoji)
    if (cid && mid && emoji) applyReactionDelta('channel', cid, mid, emoji, 1, e.user_id === getMyId())
  })
  on('REACTION_REMOVE', (e) => {
    const cid = str(e.channel_id), mid = str(e.message_id), emoji = str(e.emoji)
    if (cid && mid && emoji) applyReactionDelta('channel', cid, mid, emoji, -1, e.user_id === getMyId())
  })
  on('MESSAGE_ATTACHMENT_ADDED', (e) => {
    const cid = str(e.channel_id), mid = str(e.message_id)
    if (cid && mid) mergeAttachments('channel', cid, mid, atts(e.attachments))
  })
  on('MESSAGE_PIN_UPDATE', (e) => {
    const cid = str(e.channel_id), mid = str(e.message_id)
    if (cid && mid) patchMessage('channel', cid, mid, (m) => ({ ...m, pinned: e.pinned === true }))
    if (cid) void queryClient.invalidateQueries({ queryKey: qk.pins(cid) })
  })
  for (const t of ['EMOJI_CREATE', 'EMOJI_DELETE']) {
    on(t, (e) => {
      const sid = str(e.server_id)
      if (sid) void queryClient.invalidateQueries({ queryKey: qk.emojis(sid) })
    })
  }
  on('DM_PIN_TOGGLE', (e) => {
    const id = str(e.dm_id)
    if (id) void queryClient.invalidateQueries({ queryKey: qk.pins(id) })
  })
  on('GROUP_DM_PIN_TOGGLE', (e) => {
    const id = str(e.group_id)
    if (id) void queryClient.invalidateQueries({ queryKey: qk.pins(id) })
  })
  on('CHANNEL_PURGE', (e) => {
    const cid = str(e.channel_id)
    if (cid) void queryClient.invalidateQueries({ queryKey: ['messages', 'channel', cid] })
  })
  on('TYPING_START', (e) => {
    const cid = str(e.channel_id), uid = str(e.user_id)
    if (cid && uid && uid !== getMyId()) useTyping.getState().add(cid, uid, str(e.username) ?? '…')
  })

  // ── DM 1:1 ────────────────────────────────────────────────────────────────
  on('DM_MESSAGE', (e) => {
    const dmId = str(e.dm_id)
    if (!dmId || !isObj(e.message)) return
    const msg = { ...fromDmMessage(e.message as unknown as DmMessage), awaitingAttachments: e.pending_attachments === true }
    if (!str(msg.id)) return
    appendMessage('dm', dmId, msg)
    touchConversation(dmId, msg.content, msg.createdAt)
    if (msg.authorId !== getMyId()) useUnread.getState().increment(dmId, null)
    useTyping.getState().remove(dmId, msg.authorId)
  })
  on('DM_MESSAGE_UPDATE', (e) => {
    const dmId = str(e.dm_id), mid = str(e.message_id)
    if (dmId && mid)
      patchMessage('dm', dmId, mid, (m) => ({
        ...m,
        content: typeof e.content === 'string' ? e.content : m.content,
        editedAt: str(e.edited_at) ?? new Date().toISOString(),
      }))
  })
  on('DM_MESSAGE_DELETE', (e) => {
    const dmId = str(e.dm_id), mid = str(e.message_id)
    if (dmId && mid) removeMessage('dm', dmId, mid)
  })
  on('DM_REACTION_TOGGLE', (e) => {
    const dmId = str(e.dm_id), mid = str(e.message_id), emoji = str(e.emoji)
    if (dmId && mid && emoji && typeof e.count === 'number')
      applyReactionToggle('dm', dmId, mid, emoji, e.added === true, e.count, e.user_id === getMyId())
  })
  on('DM_ATTACHMENT_ADDED', (e) => {
    const dmId = str(e.dm_id), mid = str(e.message_id)
    if (dmId && mid) mergeAttachments('dm', dmId, mid, atts(e.attachments))
  })
  on('TYPING', (e) => {
    const cid = str(e.conversation_id), uid = str(e.user_id)
    if (cid && uid && uid !== getMyId()) useTyping.getState().add(cid, uid, str(e.username) ?? '…')
  })

  // ── Groupes ───────────────────────────────────────────────────────────────
  on('GROUP_DM_MESSAGE', (e) => {
    const gid = str(e.group_id)
    if (!gid || !isObj(e.message)) return
    const msg = { ...fromGroupMessage(e.message as unknown as GroupMessage), awaitingAttachments: e.pending_attachments === true }
    if (!str(msg.id)) return
    appendMessage('group', gid, msg)
    touchConversation(gid, msg.content, msg.createdAt, msg.authorName)
    if (msg.authorId !== getMyId()) useUnread.getState().increment(gid, null)
    useTyping.getState().remove(gid, msg.authorId)
  })
  on('GROUP_DM_MESSAGE_EDIT', (e) => {
    const gid = str(e.group_id), mid = str(e.message_id)
    if (gid && mid)
      patchMessage('group', gid, mid, (m) => ({
        ...m,
        content: typeof e.content === 'string' ? e.content : m.content,
        editedAt: new Date().toISOString(),
      }))
  })
  on('GROUP_DM_MESSAGE_DELETE', (e) => {
    const gid = str(e.group_id), mid = str(e.message_id)
    if (gid && mid) removeMessage('group', gid, mid)
  })
  on('GROUP_DM_REACTION_TOGGLE', (e) => {
    const gid = str(e.group_id), mid = str(e.message_id), emoji = str(e.emoji)
    if (gid && mid && emoji && typeof e.count === 'number')
      applyReactionToggle('group', gid, mid, emoji, e.added === true, e.count, e.user_id === getMyId())
  })
  on('GROUP_DM_ATTACHMENT_ADDED', (e) => {
    const gid = str(e.group_id), mid = str(e.message_id)
    if (gid && mid) mergeAttachments('group', gid, mid, atts(e.attachments))
  })
  for (const t of ['GROUP_DM_CREATE', 'GROUP_DM_RENAME', 'GROUP_DM_MEMBER_ADD', 'GROUP_DM_MEMBER_REMOVE', 'GROUP_DM_MEMBER_LEAVE']) {
    on(t, (e) => {
      void queryClient.invalidateQueries({ queryKey: qk.conversations })
      const gid = str(e.group_id)
      if (gid) void queryClient.invalidateQueries({ queryKey: qk.group(gid) })
    })
  }

  // ── Amis ─────────────────────────────────────────────────────────────────
  for (const t of ['FRIEND_REQUEST', 'FRIEND_ACCEPTED', 'FRIEND_REMOVED']) {
    on(t, () => void queryClient.invalidateQueries({ queryKey: qk.friendsAll }))
  }

  // ── Structure des serveurs ────────────────────────────────────────────────
  for (const t of ['CHANNEL_CREATE', 'CHANNEL_UPDATE', 'CHANNEL_DELETE', 'CHANNELS_REORDER', 'CATEGORY_CREATE', 'CATEGORY_DELETE', 'CHANNEL_ARCHIVE_UPDATE']) {
    on(t, (e) => {
      const sid = str(e.server_id) ?? (isObj(e.channel) ? str(e.channel.server_id) : null)
      if (sid) {
        void queryClient.invalidateQueries({ queryKey: qk.channels(sid) })
        void queryClient.invalidateQueries({ queryKey: qk.categories(sid) })
      } else {
        void queryClient.invalidateQueries({ queryKey: ['channels'] })
        void queryClient.invalidateQueries({ queryKey: ['categories'] })
      }
    })
  }
  on('SERVER_UPDATE', (e) => {
    void queryClient.invalidateQueries({ queryKey: qk.servers })
    const sid = str(e.server_id)
    if (sid) void queryClient.invalidateQueries({ queryKey: qk.server(sid) })
  })
  for (const t of ['SERVER_DELETE', 'MEMBER_KICKED', 'MEMBER_BANNED', 'MEMBER_REMOVE']) {
    on(t, (e) => {
      const target = str(e.user_id)
      if (t === 'SERVER_DELETE' || !target || target === getMyId()) {
        void queryClient.invalidateQueries({ queryKey: qk.servers })
      }
      const sid = str(e.server_id)
      if (sid) void queryClient.invalidateQueries({ queryKey: qk.members(sid) })
    })
  }
  for (const t of ['MEMBER_JOIN', 'MEMBER_LEAVE']) {
    on(t, (e) => {
      const sid = str(e.server_id)
      if (sid) void queryClient.invalidateQueries({ queryKey: qk.members(sid) })
    })
  }

  // ── Profil ───────────────────────────────────────────────────────────────
  on('USER_UPDATE', (e) => {
    const id = str(e.user_id) ?? (isObj(e.user) ? str(e.user.id) : null)
    if (id && id === getMyId() && isObj(e.user)) useAuth.getState().setUser(e.user as never)
    if (id) void queryClient.invalidateQueries({ queryKey: qk.user(id) })
  })

  // Nettoyage périodique des indicateurs de saisie expirés
  const pruneTimer = setInterval(() => useTyping.getState().prune(), 2000)
  offs.push(() => clearInterval(pruneTimer))

  return () => offs.forEach((off) => off())
}
