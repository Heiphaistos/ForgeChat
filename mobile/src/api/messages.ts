import * as Crypto from 'expo-crypto'
import { Alert } from 'react-native'
import { t } from '@/i18n'
import { http, path } from '@/lib/http'
import { LIMITS } from '@/config/env'
import { adaptMessage } from '@/features/chat/adapters'
import {
  normalizeEdits,
  normalizeOg,
  normalizeReactionUsers,
  normalizeSaved,
  normalizeScheduled,
  savedBody,
  type EditEntry,
  type LinkPreviewData,
  type ReactionUser,
  type SavedItem,
  type ScheduledItem,
} from '@/features/chat/messageExtras'
import { normalizeBotCommands, type SlashCommand } from '@/features/composer/commands'
import { normalizePins, type PinnedItem } from '@/features/chat/pins'
import type { Attachment, ChatMessage, ConversationRef } from '@/types/models'
import { forwardText, mustEncrypt, openRaw, openRawList, seal, withSeal } from '@/e2e/conversations'
import { isBotCommand, sendChannelText } from '@/e2e/channels'
import type { FileEntry } from '@/e2e/crypto'
import type { SupportPayload } from '@/lib/remoteSupport'
import { firstUrl, mentionMeta } from '@/e2e/channelText'
import { queryClient } from '@/lib/queryClient'

/**
 * API de messagerie unifiée : un seul contrat quel que soit le type de
 * conversation (salon, DM, groupe). Le routage vers les bons endpoints Rust
 * est centralisé ici.
 */

function base(ref: ConversationRef): string {
  switch (ref.kind) {
    case 'channel':
      return path`/servers/${ref.serverId}/channels/${ref.channelId}/messages`
    case 'dm':
      return path`/dms/${ref.dmId}/messages`
    case 'group':
      return path`/dms/groups/${ref.groupId}/messages`
  }
}

export type ReportReason = 'spam' | 'harassment' | 'nsfw' | 'other'

export interface UploadFile {
  uri: string
  name: string
  type: string
  size?: number | null
}

/** Conversation chiffrable de bout en bout (MP, groupe, salon) : [kind, id] du module e2e. */
export function e2eConv(ref: ConversationRef): ['dm' | 'group' | 'channel', string] {
  return ref.kind === 'dm' ? ['dm', ref.dmId] : ref.kind === 'group' ? ['group', ref.groupId] : ['channel', ref.channelId]
}

/** Messages bruts déchiffrés sur l'appareil, puis adaptés. */
async function adaptList(ref: ConversationRef, raw: unknown): Promise<ChatMessage[]> {
  const conv = e2eConv(ref)
  return (await openRawList(conv[0], conv[1], Array.isArray(raw) ? raw : [])).map((m) => adaptMessage(ref, m))
}

/** Commandes des bots du serveur (même cache que la barre de saisie). */
const botCommandNames = (serverId: string) =>
  queryClient
    .fetchQuery({ queryKey: ['server-commands', serverId], queryFn: () => messagesApi.commands(serverId), staleTime: 60_000 })
    .then((list) => list.map((c) => c.name))
    .catch(() => [] as string[])

/** Commandes de bot déjà confirmées pendant cette session (serveur|commande). */
const confirmedCommands = new Set<string>()

function confirmPlainCommand(serverId: string, text: string): Promise<boolean> {
  const cmd = text.trim().slice(1).split(/\s+/)[0]?.toLowerCase() ?? ''
  const k = `${serverId}|${cmd}`
  if (confirmedCommands.has(k)) return Promise.resolve(true)
  return new Promise(resolve => {
    Alert.alert(t('e2e.unencrypted'), t('e2e.botCommand.confirm', { cmd }), [
      { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
      { text: t('e2e.botCommand.send'), style: 'destructive', onPress: () => { confirmedCommands.add(k); resolve(true) } },
    ], { cancelable: true, onDismiss: () => resolve(false) })
  })
}

/**
 * Salon : mentions toujours envoyées en métadonnées ; texte chiffré dès que j'ai une clé
 * (AutoMod et aperçu de lien faits ici), sauf commande de bot connue qui part en clair.
 */
async function sendChannel(
  ref: Extract<ConversationRef, { kind: 'channel' }>, text: string, extra: Record<string, unknown>, files?: FileEntry[],
): Promise<ChatMessage> {
  const meta = { ...extra, ...mentionMeta(text) }
  if (text.startsWith('/') && isBotCommand(text, await botCommandNames(ref.serverId))) {
    // En clair (le bot doit la lire), sur une liste fournie par le serveur : confirmation d'abord.
    if (!(await confirmPlainCommand(ref.serverId, text))) throw new Error(t('e2e.botCommand.cancelled'))
    return adaptMessage(ref, await http.post<unknown>(base(ref), { content: text, ...meta }))
  }
  const sent = await sendChannelText(ref.serverId, ref.channelId, text, (body) => http.post<Record<string, unknown>>(base(ref), { ...body, ...meta }),
    { preview: true, extra: files?.length ? { f: files } : undefined })
  const m = adaptMessage(ref, sent.result)
  if (!sent.encrypted) return m
  // Le serveur ne renvoie pas le texte : on garde celui saisi, l'aperçu calculé et les clés des fichiers.
  return { ...m, content: text || null, e2e: 'ok', unencrypted: false, preview: normalizeOg(sent.extra.p, firstUrl(text) ?? ''), ...(files?.length ? { files } : {}) }
}

export const messagesApi = {
  /** Page de messages, ordre chronologique croissant. */
  async list(ref: ConversationRef, before?: string, signal?: AbortSignal): Promise<ChatMessage[]> {
    const raw = await http.get<unknown[]>(base(ref), {
      query: { limit: LIMITS.pageSize, before },
      signal,
    })
    return adaptList(ref, raw)
  },

  /** Messages autour d'un message ancien (?around=, moitié avant, moitié après), ordre chronologique. */
  async around(ref: ConversationRef, messageId: string): Promise<ChatMessage[]> {
    return adaptList(ref, await http.get<unknown[]>(base(ref), { query: { around: messageId, limit: LIMITS.pageSize } }))
  },

  async send(
    ref: ConversationRef,
    input: {
      content: string | null; replyTo?: string | null; hasAttachments?: boolean; expiresInSeconds?: number | null; files?: FileEntry[]
      /** Réponse dans un salon : false = l'auteur cité n'est pas notifié (champ reply_ping du serveur). */
      replyPing?: boolean
      /** MP : carte de support à distance, dans le contenu chiffré (`rs`). */
      support?: SupportPayload
    },
  ): Promise<ChatMessage> {
    const extra = {
      reply_to: input.replyTo ?? undefined,
      has_attachments: input.hasAttachments ?? false,
      // Messages éphémères : seuls les salons les gèrent côté serveur (comme le web).
      ...(ref.kind === 'channel' && input.expiresInSeconds ? { expires_at_seconds: input.expiresInSeconds } : {}),
      ...(ref.kind === 'channel' && input.replyTo && input.replyPing === false ? { reply_ping: false } : {}),
    }
    if (ref.kind === 'channel') return sendChannel(ref, input.content ?? '', extra, input.files)
    const conv = e2eConv(ref)
    // MP/groupe : chiffré sur l'appareil ; le serveur ne renvoie pas le texte, on garde celui saisi.
    const raw = await withSeal(conv[0], conv[1], input.content ?? '', (body) => http.post<Record<string, unknown>>(base(ref), { ...body, ...extra }), null,
      { extra: input.files?.length || input.support ? { ...(input.files?.length ? { f: input.files } : {}), ...(input.support ? { rs: input.support } : {}) } : undefined })
    const m = adaptMessage(ref, raw)
    return raw?.enc
      ? { ...m, content: input.content, e2e: 'ok', ...(input.files?.length ? { files: input.files } : {}), ...(input.support ? { support: input.support } : {}) }
      : m
  },

  /** Édition chiffrée : même id client que le message (lié à l'AAD), ou un nouveau pour un ancien message. */
  async edit(ref: ConversationRef, messageId: string, content: string, clientMsgId?: string | null): Promise<void> {
    const url = base(ref) + path`/${messageId}`
    const cmid = clientMsgId ?? Crypto.randomUUID()
    if (ref.kind === 'channel') {
      // `content` est une chaîne côté serveur : vide quand le texte est chiffré.
      await sendChannelText(ref.serverId, ref.channelId, content, (body) => http.patch(url, { ...body, content: body.content ?? '' }), { clientMsgId: cmid, edit: true })
      return
    }
    const conv = e2eConv(ref)
    await withSeal(conv[0], conv[1], content, (body) => http.patch(url, body), cmid)
  },

  remove(ref: ConversationRef, messageId: string) {
    return http.delete(base(ref) + path`/${messageId}`)
  },

  /** Réaction : ajout/retrait explicite pour les salons, bascule pour les DM/groupes.
   *  Super réaction : salons seulement, 10 par 24 h (429 au-delà). */
  react(ref: ConversationRef, messageId: string, emoji: string, currentlyMine: boolean, isSuper = false) {
    const p = base(ref) + (isSuper ? path`/${messageId}/super-reactions/${emoji}` : path`/${messageId}/reactions/${emoji}`)
    if (ref.kind === 'channel') return currentlyMine ? http.delete(p) : http.put(p)
    return http.put(p)
  },

  async upload(ref: ConversationRef, messageId: string, files: UploadFile[]): Promise<Attachment[]> {
    const fd = new FormData()
    for (const f of files) fd.append('file', { uri: f.uri, name: f.name, type: f.type } as unknown as Blob)
    return http.upload<Attachment[]>(base(ref) + path`/${messageId}/attachments`, fd)
  },

  markRead(ref: ConversationRef) {
    switch (ref.kind) {
      case 'channel':
        return http.post(path`/channels/${ref.channelId}/read`)
      case 'dm':
        return http.post(path`/dms/${ref.dmId}/read`)
      case 'group':
        return http.post(path`/dms/groups/${ref.groupId}/read`)
    }
  },

  /** « Marquer comme non lu » à partir de `messageId` (inclus). Groupe : même route que le MP. */
  markUnread(ref: ConversationRef, messageId: string) {
    const p = ref.kind === 'channel' ? path`/channels/${ref.channelId}/unread` : path`/dms/${ref.kind === 'dm' ? ref.dmId : ref.groupId}/unread`
    return http.post<unknown>(p, { message_id: messageId })
  },

  /**
   * Épingle (pinned=true) ou désépingle. Le groupe n'a qu'une bascule côté serveur :
   * l'appelant doit connaître l'état actuel (liste des épinglés).
   */
  pin(ref: ConversationRef, messageId: string, pinned: boolean) {
    switch (ref.kind) {
      case 'channel': {
        const p = path`/servers/${ref.serverId}/channels/${ref.channelId}/messages/${messageId}/pin`
        return pinned ? http.post(p) : http.delete(p)
      }
      case 'dm': {
        const p = path`/dms/${ref.dmId}/pins/${messageId}`
        return pinned ? http.post(p) : http.delete(p)
      }
      case 'group':
        return http.put(path`/dms/groups/${ref.groupId}/messages/${messageId}/pin`)
    }
  },

  /** Messages épinglés, du plus récemment épinglé au plus ancien. */
  async pins(ref: ConversationRef): Promise<PinnedItem[]> {
    const p =
      ref.kind === 'channel'
        ? path`/servers/${ref.serverId}/channels/${ref.channelId}/pins`
        : ref.kind === 'dm'
          ? path`/dms/${ref.dmId}/pins`
          : path`/dms/groups/${ref.groupId}/pins`
    const raw = await http.get<unknown>(p)
    const conv = e2eConv(ref)
    if (!Array.isArray(raw)) return normalizePins(ref.kind, raw)
    // MP : { message: {...} } ; salon et groupe : le message lui-même.
    if (ref.kind !== 'dm') return normalizePins(ref.kind, await openRawList(conv[0], conv[1], raw))
    const msgs = await openRawList('dm', conv[1], raw.map((r) => (r as { message?: unknown }).message ?? null))
    return normalizePins(ref.kind, raw.map((r, i) => ({ ...(r as object), message: msgs[i] })))
  },

  /**
   * Copie le message (salon ou DM) dans un salon textuel ; le serveur applique les règles d'envoi du salon cible.
   * Salon cible chiffré : le texte (mémorisé par l'écran de conversation) est chiffré pour lui ;
   * sinon une source chiffrée part en clair (`content`, avertissement à l'écran de transfert).
   */
  async forward(messageId: string, channelId: string) {
    const src = forwardText.get(messageId)
    const url = path`/messages/${messageId}/forward`
    if (src?.text && (await mustEncrypt('channel', channelId))) {
      const sealed = await seal('channel', channelId, src.text)
      if (sealed) return http.post(url, { channel_id: channelId, ...sealed })
    }
    return http.post(url, { channel_id: channelId, content: src?.encrypted ? src.text : undefined })
  },

  /** Rappel livré par l'événement temps réel REMINDER à l'échéance (reminders.rs). */
  remind(messageId: string, at: Date) {
    return http.post(path`/messages/${messageId}/remind`, { remind_at: at.toISOString() })
  },

  async edits(messageId: string): Promise<EditEntry[]> {
    return normalizeEdits(await http.get<unknown>(path`/messages/${messageId}/edits`))
  },

  /** Messages de salon chiffrés : déchiffrés ici avec la clé du salon (auteur `author_id`). */
  async saved(): Promise<SavedItem[]> {
    const raw = await http.get<unknown>('/saved')
    if (!Array.isArray(raw)) return normalizeSaved(raw)
    const out: unknown[] = []
    for (const r of raw) {
      const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
      out.push(o.server_id && o.enc && typeof o.channel_id === 'string' ? await openRaw('channel', o.channel_id, o) : r)
    }
    return normalizeSaved(out)
  },

  save(ref: ConversationRef, m: ChatMessage) {
    return http.post('/saved', savedBody(ref, m))
  },

  unsave(messageId: string) {
    return http.delete(path`/saved/${messageId}`)
  },

  /** Qui a réagi avec `emoji` (salons et DM 1:1 ; 100 personnes au plus). */
  async reactionUsers(messageId: string, emoji: string, isSuper = false): Promise<ReactionUser[]> {
    const query = isSuper ? { message_id: messageId, emoji, is_super: 'true' } : { message_id: messageId, emoji }
    return normalizeReactionUsers(await http.get<unknown>('/reactions', { query }))
  },

  /** Aperçu d'un lien (titre, description, image) ; le serveur filtre les adresses privées (SSRF). */
  async linkPreview(url: string, signal?: AbortSignal): Promise<LinkPreviewData | null> {
    return normalizeOg(await http.get<unknown>('/og', { query: { url }, signal }), url)
  },

  /** Emoji d'un serveur quelconque, par identifiant (« <:nom:id> »). */
  emoji: (id: string) => http.get<{ url?: unknown; name?: unknown }>(path`/emojis/${id}`),

  /** Commandes déclarées par les bots du serveur. */
  async commands(serverId: string): Promise<SlashCommand[]> {
    return normalizeBotCommands(await http.get<unknown>(path`/servers/${serverId}/commands`))
  },

  /** Mes messages programmés non encore envoyés dans ce salon. */
  async scheduled(serverId: string, channelId: string): Promise<ScheduledItem[]> {
    const raw = await http.get<unknown>(path`/servers/${serverId}/channels/${channelId}/scheduled`)
    return normalizeScheduled(await openRawList('channel', channelId, Array.isArray(raw) ? raw : []))
  },
  /** Chiffré à la création (portée du salon) ; AutoMod appliqué avant. */
  schedule: (serverId: string, channelId: string, content: string, sendAt: Date) =>
    sendChannelText(serverId, channelId, content, (body) =>
      http.post(path`/servers/${serverId}/channels/${channelId}/scheduled`, { ...body, content: body.content ?? '', send_at: sendAt.toISOString() })),
  cancelScheduled: (id: string) => http.delete(path`/scheduled/${id}`),

  /** Signalement (messages de salon uniquement côté serveur). */
  report(messageId: string, reason: ReportReason, comment?: string, plaintext?: string | null) {
    // Message chiffré (MP ou salon) : le signaleur joint le texte déchiffré (seul moyen de modérer).
    return http.post(path`/messages/${messageId}/report`, { reason, comment, content: plaintext ?? undefined })
  },
}
