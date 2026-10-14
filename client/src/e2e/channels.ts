// Salons de serveur chiffrés côté web (docs/CHIFFREMENT-E2E.md §4.3, §10) :
// envoi (commande de bot en clair, AutoMod, mentions, aperçu de lien) et état
// « je chiffre ici ». Le texte déchiffré ne quitte jamais l'appareil.
import { useQuery } from '@tanstack/react-query'
import api from '../api/client'
import { confirm } from '../components/ui/ConfirmModal'
import { t } from '../i18n'
import { useAccountKey } from './accountKey'
import { automodBlock, mentionMeta, previewAllowed, previewUrl, type AutoModBlock, type AutoModRules } from './channelText'
import { completeChannelKeys, lockedText, mustEncrypt, openText, sendErrorText, withSeal } from './conversations'
import type { EncPayload } from './crypto'

/** Règles AutoMod et commandes de bot : relues au plus toutes les 5 minutes. */
const TTL = 5 * 60_000

function perServer<T>(load: (serverId: string) => Promise<T>, fallback: T) {
  const cache = new Map<string, { v: T; at: number }>()
  return async (serverId: string): Promise<T> => {
    const hit = cache.get(serverId)
    if (hit && Date.now() - hit.at < TTL) return hit.v
    try {
      const v = await load(serverId)
      cache.set(serverId, { v, at: Date.now() })
      return v
    } catch {
      return fallback // hors ligne : pas de cache, on réessaiera au prochain envoi
    }
  }
}

const automodRules = perServer<AutoModRules | null>(
  id => api.get<AutoModRules>(`/servers/${id}/automod/rules`).then(r => r.data), null)
const botCommands = perServer<Set<string>>(
  id => api.get<{ name: string }[]>(`/servers/${id}/commands`).then(r => new Set(r.data.map(c => c.name.toLowerCase()))), new Set())

/** Mes derniers textes envoyés par serveur (anti-spam AutoMod), en mémoire seulement. */
const recentSent = new Map<string, { text: string; at: number }[]>()

/** Envoi refusé par une règle AutoMod, avant tout chiffrement (le brouillon est gardé). */
export class AutoModError extends Error {
  constructor(readonly reason: AutoModBlock) { super('AUTOMOD') }
}

/** Commande de bot refusée par l'utilisateur (elle aurait été envoyée en clair). */
export class PlainCommandCancelled extends Error {
  constructor() { super('PLAIN_COMMAND_CANCELLED') }
}

/** Commandes déjà confirmées pendant cette session (serveur|commande). */
const confirmedCommands = new Set<string>()

/**
 * Une commande de bot part en clair (le bot doit la lire) et la liste des commandes vient du
 * serveur : confirmation explicite, une fois par commande et par session, avant tout envoi.
 */
async function confirmPlainCommand(serverId: string, cmd: string): Promise<boolean> {
  const k = `${serverId}|${cmd}`
  if (confirmedCommands.has(k)) return true
  const ok = await confirm({ message: t('e2e.botCommand.confirm', { cmd }), confirmLabel: t('e2e.botCommand.send') })
  if (ok) confirmedCommands.add(k)
  return ok
}

/** Texte d'erreur d'un envoi dans un salon : règle AutoMod précise, sinon comme les MP. */
export const channelSendError = (e: unknown, fallback: string) =>
  e instanceof AutoModError ? t(`e2e.automod.${e.reason}`)
    : e instanceof PlainCommandCancelled ? t('e2e.botCommand.cancelled')
      : sendErrorText(e, fallback)

/** Aperçu du premier lien, demandé par l'expéditeur (court délai, erreurs ignorées). */
async function linkPreview(text: string): Promise<Record<string, unknown> | null> {
  const url = previewUrl(text)
  if (!url || !previewAllowed(url)) return null
  try {
    // Réglage « aperçus de liens » coupé : le lien ne part pas au serveur.
    const prefs = await api.get('/user/settings', { timeout: 4000 })
    if (prefs.data?.link_preview === false) return null
    const { data } = await api.get(`/og?url=${encodeURIComponent(url)}`, { timeout: 4000 })
    return data && (data.title || data.description || data.image) ? data : null
  } catch {
    return null
  }
}

/** Corps envoyé au serveur : clair (`content`) ou chiffré (`enc` + `client_msg_id`). */
export interface ChannelBody { content: string | null; enc?: EncPayload; client_msg_id?: string }

interface SendOpts {
  serverId: string
  /** Id client imposé (édition : celui du message ; fil, publication). */
  clientMsgId?: string | null
  /** Portée de salon (fil, publication). */
  scope?: string
  /** Contenu chiffré additionnel (titre…). */
  extra?: Record<string, unknown>
  /** Message de salon : aperçu de lien calculé ici, mis dans le contenu chiffré. */
  preview?: boolean
  /** Édition : pas comptée pour l'anti-spam. */
  edit?: boolean
  /** Message du salon : une commande de bot connue (`/nom …`) part en clair. */
  command?: boolean
}

/**
 * Envoie (ou modifie) `text` dans un salon : en clair pour une commande de bot
 * connue, sinon chiffré dès que j'ai une clé de compte, après les règles AutoMod.
 */
export async function sendChannel<T>(channelId: string, text: string, post: (body: ChannelBody) => Promise<T>, o: SendOpts): Promise<T> {
  const cmd = o.command && text.startsWith('/') ? text.slice(1).split(/\s+/)[0]?.toLowerCase() : ''
  if (cmd && (await botCommands(o.serverId)).has(cmd)) {
    if (!(await confirmPlainCommand(o.serverId, cmd))) throw new PlainCommandCancelled()
    return post({ content: text })
  }
  const encrypt = await mustEncrypt('channel', channelId)
  const now = Date.now()
  const recent = (recentSent.get(o.serverId) ?? []).filter(r => now - r.at < 10_000)
  if (encrypt && text) {
    const block = automodBlock(await automodRules(o.serverId), text, o.edit ? [] : recent, now)
    if (block) throw new AutoModError(block)
  }
  const extra = { ...o.extra }
  if (encrypt && o.preview) {
    const p = await linkPreview(text)
    if (p) extra.p = p
  }
  const res = await withSeal('channel', channelId, text, post, o.clientMsgId, { scope: o.scope, extra })
  if (text && !o.edit) recentSent.set(o.serverId, [...recent, { text, at: now }].slice(-10))
  if (encrypt) void completeChannelKeys(channelId)
  return res
}

/** Message de salon : mentions déclarées en métadonnées, toujours (même en clair). */
export const postMessage = <T>(serverId: string, channelId: string, text: string,
  post: (body: ChannelBody & ReturnType<typeof mentionMeta>) => Promise<T>, extra?: Record<string, unknown>) =>
  sendChannel(channelId, text, body => post({ ...body, ...mentionMeta(text) }), { serverId, preview: true, command: true, extra })

/** Édition d'un message de salon : même id client (lié à l'AAD), ou un nouveau pour un ancien message en clair. */
export const editMessage = <T>(serverId: string, channelId: string, text: string, clientMsgId: string | null | undefined,
  patch: (body: { content: string; enc?: EncPayload; client_msg_id?: string }) => Promise<T>) =>
  sendChannel(channelId, text, body => patch({ ...body, content: body.content ?? '' }),
    { serverId, clientMsgId: clientMsgId ?? crypto.randomUUID(), preview: true, edit: true })

/** Aperçu d'un message de salon (mention, notification) : déchiffré ici, sinon texte d'attente. */
export async function channelPreview(m: {
  channel_id: string; content?: string | null; enc?: EncPayload | null; client_msg_id?: string | null; author_id?: string
}): Promise<string> {
  if (!m.enc) return m.content ?? ''
  return (m.author_id ? await openText('channel', m.channel_id, m.enc, m.author_id, m.client_msg_id) : null) ?? lockedText()
}

/** Vrai si j'écris chiffré dans ce salon (j'ai une clé de compte) ; undefined pendant le chargement. */
export function useChannelEncrypted(channelId: string | undefined): boolean | undefined {
  const status = useAccountKey(s => s.status)
  const { data } = useQuery({
    queryKey: ['e2e_channel', channelId, status],
    queryFn: () => mustEncrypt('channel', channelId!),
    enabled: !!channelId,
    staleTime: 60_000,
  })
  return data
}
