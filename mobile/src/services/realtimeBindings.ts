import { usersApi } from '@/api/users'
import { answerKeyRequest, becameReady, forgetConv, openRaw, openText } from '@/e2e/conversations'
import { useAccountKey } from '@/e2e/accountKey'
import type { EncPayload } from '@/e2e/crypto'
import {
  appendMessage,
  applyReactionDelta,
  applyReactionToggle,
  flattenNewestFirst,
  mergeAttachments,
  messagesKey,
  type MessagesData,
  patchMessage,
  removeMessage,
} from '@/features/chat/cache'
import { fromDmMessage, fromGroupMessage, fromServerMessage } from '@/features/chat/adapters'
import { logger } from '@/lib/logger'
import { qk, queryClient } from '@/lib/queryClient'
import { realtime, type RealtimeEvent } from '@/lib/realtime'
import { showNotice, showReminder } from '@/services/push'
import { activityFrom } from '@/features/social/rich'
import { parseUnreadEvent } from '@/features/servers/discordFeatures'
import { t as tr } from '@/i18n'
import { getMyId, useAuth } from '@/stores/auth'
import { usePresence } from '@/stores/presence'
import { rememberUserStyle } from '@/stores/nameStyles'
import { useTyping } from '@/stores/typing'
import { useUnread } from '@/stores/unread'
import type {
  Attachment,
  ConversationSummary,
  DmMessage,
  GroupMessage,
  ServerMessage,
  User,
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
        return id && st ? [{ user_id: id, status: st, activity: activityFrom(u) }] : []
      }),
    )
  })
  on('PRESENCE_UPDATE', (e) => {
    const id = str(e.user_id)
    const st = str(e.status)
    if (id && st) usePresence.getState().set(id, st, activityFrom(e))
    // Statut perso posé, changé ou expiré (le serveur l'efface à l'échéance).
    if (id && 'custom_status' in e) {
      const patch = { custom_status: str(e.custom_status), custom_status_expires_at: str(e.custom_status_expires_at) }
      if (id === getMyId()) useAuth.getState().setUser(patch)
      queryClient.setQueryData<User>(qk.user(id), (old) => (old ? { ...old, ...patch } : old))
    }
  })

  // ── Salons de serveur ──────────────────────────────────────────────────────
  on('MESSAGE_CREATE', async (e) => {
    if (!isObj(e.message)) return
    const channelId = str(e.message.channel_id)
    if (!channelId || !str(e.message.id)) return
    // Salon chiffré : texte déchiffré ici, sur l'appareil.
    const raw = (await openRaw('channel', channelId, e.message)) as unknown as ServerMessage
    const msg = { ...fromServerMessage(raw), awaitingAttachments: e.pending_attachments === true }
    appendMessage('channel', channelId, msg)
    if (msg.authorId !== getMyId()) useUnread.getState().increment(channelId, str(e.server_id))
    useTyping.getState().remove(channelId, msg.authorId)
  })
  // Mention de moi dans un salon (résolue par le serveur) : pastille rouge dans la liste des salons.
  on('MENTION_CREATE', (e) => {
    const channelId = isObj(e.mention) ? str(e.mention.channel_id) : null
    if (channelId && isObj(e.mention) && str(e.mention.server_id)) useUnread.getState().addMention(channelId)
  })
  // Lecture sur une autre session : « lu » remet à zéro ; `unread: true` (marquer comme non lu)
  // pose les compteurs reçus tels quels (salon, MP ou groupe).
  on('READ_STATE_UPDATE', (e) => {
    const patch = parseUnreadEvent(e)
    if (patch) return useUnread.getState().setUnread(patch.channelId, patch.count, patch.mentionCount, patch.serverId)
    if (e.unread !== undefined) return
    const st = useUnread.getState()
    const cid = str(e.channel_id), sid = str(e.server_id)
    if (cid) st.clear(cid)
    else if (e.all === true) st.load([])
    else if (e.whole_server === true && sid) Object.keys(st.counts).forEach((id) => st.serverOf[id] === sid && st.clear(id))
  })
  on('MESSAGE_UPDATE', async (e) => {
    const cid = str(e.channel_id)
    const mid = str(e.message_id)
    if (!cid || !mid) return
    // Édition chiffrée : auteur = celui du message en mémoire (lié à l'AAD).
    const author = str(e.author_id) ?? flattenNewestFirst(queryClient.getQueryData<MessagesData>(messagesKey('channel', cid))).find((m) => m.id === mid)?.authorId
    const text = isObj(e.enc)
      ? author ? await openText('channel', cid, e.enc as unknown as EncPayload, author, str(e.client_msg_id)) : null
      : typeof e.content === 'string' ? e.content : null
    patchMessage('channel', cid, mid, (m) => ({
      ...m,
      content: text ?? m.content,
      clientMsgId: str(e.client_msg_id) ?? m.clientMsgId,
      // Nouveau contenu chiffré : l'aperçu de lien n'est plus celui de l'ancien texte.
      ...(isObj(e.enc) ? { e2e: text === null ? m.e2e : 'ok', preview: text === null ? m.preview : null, unencrypted: false } : {}),
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
    if (cid && mid && emoji) applyReactionDelta('channel', cid, mid, emoji, 1, e.user_id === getMyId(), e.is_super === true)
  })
  on('REACTION_REMOVE', (e) => {
    const cid = str(e.channel_id), mid = str(e.message_id), emoji = str(e.emoji)
    if (cid && mid && emoji) applyReactionDelta('channel', cid, mid, emoji, -1, e.user_id === getMyId(), e.is_super === true)
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
  // Fils (threads.rs, uploads.rs) : liste du salon (badges, compteurs) et messages du fil.
  for (const t of ['THREAD_CREATE', 'THREAD_UPDATE', 'THREAD_MESSAGE', 'THREAD_MESSAGE_DELETE']) {
    on(t, (e) => {
      const cid = str(e.channel_id)
      if (cid) void queryClient.invalidateQueries({ queryKey: qk.threads(cid) })
    })
  }
  for (const t of ['THREAD_MESSAGE', 'THREAD_MESSAGE_EDIT', 'THREAD_MESSAGE_DELETE', 'THREAD_REACTION_TOGGLE', 'THREAD_ATTACHMENT_ADDED']) {
    on(t, (e) => {
      const tid = str(e.thread_id)
      if (tid) void queryClient.invalidateQueries({ queryKey: qk.threadMessages(tid) })
    })
  }
  // Forums (forum.rs) : liste des publications du salon et publication ouverte.
  for (const t of ['FORUM_POST_CREATE', 'FORUM_POST_UPDATE', 'FORUM_POST_DELETE', 'FORUM_REPLY_CREATE', 'FORUM_REPLY_DELETE']) {
    on(t, (e) => {
      const cid = str(e.channel_id)
      if (cid) void queryClient.invalidateQueries({ queryKey: qk.forum(cid) })
    })
  }
  for (const t of ['FORUM_POST_UPDATE', 'FORUM_REPLY_CREATE', 'FORUM_REPLY_EDIT', 'FORUM_REPLY_DELETE', 'FORUM_REPLY_REACTION', 'FORUM_REPLY_ATTACHMENT_ADDED']) {
    on(t, (e) => {
      const pid = str(e.post_id)
      if (pid) void queryClient.invalidateQueries({ queryKey: qk.forumPost(pid) })
    })
  }
  // Sondages (polls.rs) : l'événement ne porte pas les résultats, on relit le sondage.
  for (const t of ['POLL_VOTE', 'POLL_CLOSED']) {
    on(t, (e) => {
      const pid = str(e.poll_id)
      if (pid) void queryClient.invalidateQueries({ queryKey: qk.poll(pid) })
    })
  }
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

  // ── Chiffrement de bout en bout (MP et groupes) ─────────────────────────────
  // Texte d'une édition chiffrée, déchiffré ici ; null si illisible (on garde l'ancien).
  const editedText = async (kind: 'dm' | 'group', id: string, e: RealtimeEvent): Promise<string | null> => {
    if (!isObj(e.enc)) return typeof e.content === 'string' ? e.content : null
    const author = str(e.sender_id)
    return author ? openText(kind, id, e.enc as unknown as EncPayload, author, str(e.client_msg_id)) : null
  }
  on('KEY_REQUEST', (e) => void answerKeyRequest(e))
  on('E2E_KEYS', (e) => {
    const kind = e.conv_kind === 'dm' || e.conv_kind === 'group' || e.conv_kind === 'channel' ? e.conv_kind : null
    const id = str(e.conv_id)
    if (!kind || !id) return
    // Clés reçues : on relit tout ce qui déchiffre (messages, épinglés, fils, forums, sondages,
    // programmés, enregistrés, mentions…), les contenus en attente s'ouvrent.
    // ponytail: invalide toutes les requêtes (événement rare) plutôt que de lister chaque clé chiffrée.
    forgetConv(kind, id)
    void queryClient.invalidateQueries()
  })
  // Clé de compte prête après l'ouverture d'un écran (déverrouillage au démarrage) : même relecture.
  offs.push(useAccountKey.subscribe((s, prev) => {
    if (!becameReady(s, prev)) return
    forgetConv()
    void queryClient.invalidateQueries()
  }))
  // Clé de récupération du serveur créée ou changée : les prochaines époques doivent l'inclure.
  on('SERVER_KEY', () => forgetConv())

  // ── DM 1:1 ────────────────────────────────────────────────────────────────
  on('DM_MESSAGE', async (e) => {
    const dmId = str(e.dm_id)
    if (!dmId || !isObj(e.message)) return
    const raw = await openRaw('dm', dmId, e.message)
    const msg = { ...fromDmMessage(raw as unknown as DmMessage), awaitingAttachments: e.pending_attachments === true }
    if (!str(msg.id)) return
    appendMessage('dm', dmId, msg)
    touchConversation(dmId, msg.content, msg.createdAt)
    if (msg.authorId !== getMyId()) useUnread.getState().increment(dmId, null)
    useTyping.getState().remove(dmId, msg.authorId)
  })
  on('DM_MESSAGE_UPDATE', async (e) => {
    const dmId = str(e.dm_id), mid = str(e.message_id)
    if (!dmId || !mid) return
    const text = await editedText('dm', dmId, e)
    patchMessage('dm', dmId, mid, (m) => ({
      ...m,
      content: text ?? m.content,
      clientMsgId: str(e.client_msg_id) ?? m.clientMsgId,
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
  on('GROUP_DM_MESSAGE', async (e) => {
    const gid = str(e.group_id)
    if (!gid || !isObj(e.message)) return
    const raw = await openRaw('group', gid, e.message)
    const msg = { ...fromGroupMessage(raw as unknown as GroupMessage), awaitingAttachments: e.pending_attachments === true }
    if (!str(msg.id)) return
    appendMessage('group', gid, msg)
    touchConversation(gid, msg.content, msg.createdAt, msg.authorName)
    if (msg.authorId !== getMyId()) useUnread.getState().increment(gid, null)
    useTyping.getState().remove(gid, msg.authorId)
  })
  on('GROUP_DM_MESSAGE_EDIT', async (e) => {
    const gid = str(e.group_id), mid = str(e.message_id)
    if (!gid || !mid) return
    const text = await editedText('group', gid, e)
    patchMessage('group', gid, mid, (m) => ({
      ...m,
      content: text ?? m.content,
      clientMsgId: str(e.client_msg_id) ?? m.clientMsgId,
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
  // CHANNEL_UPDATE peut être partiel (statut vocal, réglages du forum) : on relit la liste plutôt que de
  // fusionner. CATEGORIES_REORDER ne porte que les catégories visibles : la relecture le respecte aussi.
  for (const t of ['CHANNEL_CREATE', 'CHANNEL_UPDATE', 'CHANNEL_DELETE', 'CHANNELS_REORDER', 'CATEGORY_CREATE', 'CATEGORY_UPDATE', 'CATEGORIES_REORDER', 'CATEGORY_DELETE', 'CHANNEL_ARCHIVE_UPDATE']) {
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
  // Rôles : recalcul des permissions affichées (features/servers/perms).
  for (const t of ['ROLE_CREATE', 'ROLE_UPDATE', 'ROLE_DELETE']) {
    on(t, (e) => {
      const sid = str(e.server_id)
      if (sid) void queryClient.invalidateQueries({ queryKey: qk.server(sid) })
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
  // Surnom et profil par serveur (avatar, bannière, bio) : la liste des membres les porte.
  for (const t of ['MEMBER_JOIN', 'MEMBER_LEAVE', 'MEMBER_NICKNAME_UPDATE', 'MEMBER_PROFILE_UPDATE']) {
    on(t, (e) => {
      const sid = str(e.server_id)
      if (sid) void queryClient.invalidateQueries({ queryKey: qk.members(sid) })
    })
  }

  // ── Profil ───────────────────────────────────────────────────────────────
  on('USER_UPDATE', (e) => {
    const id = str(e.user_id) ?? (isObj(e.user) ? str(e.user.id) : null)
    if (id && id === getMyId() && isObj(e.user)) useAuth.getState().setUser(e.user as never)
    rememberUserStyle(e.user)
    if (id) void queryClient.invalidateQueries({ queryKey: qk.user(id) })
  })

  // ── Rappels de messages (reminders.rs) ─────────────────────────────────────
  on('REMINDER', (e) => void showReminder(typeof e.content === 'string' ? e.content : null))
  // Anniversaire d'un ami (birthdays.rs, une fois par an).
  on('BIRTHDAY_TODAY', (e) => {
    const name = str(e.name)
    if (name) void showNotice(tr('soc.bday.title'), tr('soc.bday.toast', { name }))
  })

  // Nettoyage périodique des indicateurs de saisie expirés
  const pruneTimer = setInterval(() => useTyping.getState().prune(), 2000)
  offs.push(() => clearInterval(pruneTimer))

  return () => offs.forEach((off) => off())
}
