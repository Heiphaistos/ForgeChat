import { t } from '@/i18n'
import { ApiError, errorMessage } from '@/lib/http'
import { PERM, type ServerPerms } from './perms'
import { toPayload, type SyncTree } from './discordSyncTree'

/** Configuration de la synchro Discord (handlers/discord_import/sync.rs::config_json). Le jeton n'est jamais renvoyé : `has_token` seulement. */
export interface SyncConfig {
  configured: boolean
  guildId: string
  hasToken: boolean
  intervalHours: 24 | 48
  excludedCategories: string[]
  enabled: boolean
  syncEmojis: boolean
  syncMode: 'full' | 'content'
  autoIncludeNew: boolean
  nextSyncAt: string | null
  lastSyncAt: string | null
  lastStatus: 'ok' | 'partial' | 'error' | null
  lastError: string | null
  lastImported: number
  running: boolean
  guildName: string | null
}

const str = (v: unknown) => (typeof v === 'string' ? v : null)

export function normalizeConfig(raw: unknown): SyncConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const status = r.last_status
  return {
    configured: r.configured === true,
    guildId: str(r.guild_id) ?? '',
    hasToken: r.has_token === true,
    intervalHours: r.interval_hours === 48 ? 48 : 24,
    excludedCategories: Array.isArray(r.excluded_categories) ? r.excluded_categories.filter((x): x is string => typeof x === 'string') : [],
    enabled: r.enabled === true,
    syncEmojis: r.sync_emojis !== false,
    syncMode: r.sync_mode === 'content' ? 'content' : 'full',
    autoIncludeNew: r.auto_include_new !== false,
    nextSyncAt: str(r.next_sync_at),
    lastSyncAt: str(r.last_sync_at),
    lastStatus: status === 'ok' || status === 'partial' || status === 'error' ? status : null,
    lastError: str(r.last_error),
    lastImported: typeof r.last_imported === 'number' ? r.last_imported : 0,
    running: r.running === true,
    guildName: str(r.guild_name),
  }
}

export interface SyncForm {
  guildId: string
  token: string
  intervalHours: 24 | 48
  enabled: boolean
  syncEmojis: boolean
  syncMode: 'full' | 'content'
  autoIncludeNew: boolean
}

export const formFromConfig = (c: SyncConfig): SyncForm => ({
  guildId: c.guildId,
  token: '',
  intervalHours: c.intervalHours,
  enabled: c.enabled,
  syncEmojis: c.syncEmojis,
  syncMode: c.syncMode,
  autoIncludeNew: c.autoIncludeNew,
})

/** Identifiant de serveur Discord (snowflake) : 15 à 21 chiffres, comme rules::validate_guild_id. */
export const isGuildId = (s: string) => /^\d{15,21}$/.test(s.trim())

/** Enregistrable : identifiant valide, et un jeton (déjà enregistré ou saisi) si l'activation est demandée. */
export const canSave = (f: SyncForm, hasToken: boolean) => isGuildId(f.guildId) && (!f.enabled || hasToken || f.token.trim().length > 0)

/**
 * Corps du PUT. `bot_token` absent si vide (le serveur garde le jeton enregistré) ;
 * `excluded_categories` renvoyé tel quel (règles par nom gérées sur le web) ; la sélection
 * n'est envoyée que si l'arbre a été chargé (sinon la sélection enregistrée est conservée).
 */
export function buildPutBody(f: SyncForm, excludedCategories: string[], tree: SyncTree | null, sel: Set<string>) {
  const token = f.token.trim()
  return {
    guild_id: f.guildId.trim(),
    ...(token ? { bot_token: token } : {}),
    interval_hours: f.intervalHours,
    excluded_categories: excludedCategories,
    enabled: f.enabled,
    sync_emojis: f.syncEmojis,
    sync_mode: f.syncMode,
    auto_include_new: f.autoIncludeNew,
    ...(tree ? toPayload(tree, sel) : {}),
  }
}

/** GET/PUT/run/tree : MANAGE_SERVER. */
export const canManageDiscordSync = (p: ServerPerms) => p.has(PERM.MANAGE_SERVER)
/** DELETE : propriétaire seulement (effacer le jeton revient à le changer). */
export const canUnlinkDiscordSync = (p: ServerPerms) => p.isOwner

/** Message d'erreur d'une action de synchro : 429 (limite par compte/serveur, délai de 5 min) affiché proprement, sans attente. */
export function syncError(e: unknown): string {
  if (e instanceof ApiError && e.status === 429 && !e.retryAfter) return e.message || t('dsync.rateLimited')
  return errorMessage(e)
}
