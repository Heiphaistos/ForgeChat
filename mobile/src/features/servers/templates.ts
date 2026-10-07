import { dateLocale, t as tr, type Key } from '@/i18n'

/**
 * Modèles de serveur — mêmes modèles et même parcours que le client web (CreateServerModal) :
 *  - « Créer depuis zéro » ;
 *  - modèles intégrés (Gaming, Amis, Communauté, Étude, Créateur, Jötunheim), tenus par le
 *    serveur (GET /templates → builtin) ; noms et descriptions traduits ici (server.tpl.<id>) ;
 *  - modèles publics et « Mes modèles » (créés depuis un serveur).
 *
 * Création : le serveur fait tout, en une transaction (POST /servers {template} pour un modèle
 * intégré, POST /templates/:id/use pour un modèle partagé).
 */

export interface TemplateCategory {
  id?: string
  name: string
  position?: number
}
export interface TemplateChannel {
  id?: string
  name: string
  type: string
  position?: number
  category_id?: string | null
}
export interface TemplateRole {
  name: string
  color?: number
  position?: number
}
export interface TemplateData {
  categories: TemplateCategory[]
  channels: TemplateChannel[]
  roles: TemplateRole[]
}
export type TemplateSource = 'builtin' | 'public' | 'mine'
export interface ServerTemplate {
  id: string
  name: string
  description: string
  data: TemplateData
  source: TemplateSource
}

const str = (v: unknown, max = 100): string | null => (typeof v === 'string' && v.trim() ? v.slice(0, max) : null)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** Données de modèle lues de façon défensive (elles viennent du serveur, saisies par des tiers). */
export function parseTemplateData(raw: unknown): TemplateData {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]).filter((x) => x && typeof x === 'object') : [])
  return {
    categories: arr(o.categories)
      .map((c) => ({ id: str(c.id, 64) ?? undefined, name: str(c.name) ?? '', position: num(c.position) }))
      .filter((c) => c.name),
    channels: arr(o.channels)
      .map((c) => ({
        id: str(c.id, 64) ?? undefined,
        name: str(c.name) ?? '',
        type: str(c.type, 20) ?? 'text',
        position: num(c.position),
        category_id: str(c.category_id, 64),
      }))
      .filter((c) => c.name),
    roles: arr(o.roles)
      .map((r) => ({ name: str(r.name) ?? '', color: num(r.color), position: num(r.position) }))
      .filter((r) => r.name),
  }
}

const BUILTIN_IDS = ['gaming', 'friends', 'community', 'study', 'creator', 'jotunheim'] as const

/** Réponse de GET /templates → modèles intégrés, publics et personnels (même libellés que le web). */
export function parseRemoteTemplates(raw: unknown): { builtin: ServerTemplate[]; public: ServerTemplate[]; mine: ServerTemplate[] } {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const one = (source: TemplateSource) => (t: Record<string, unknown>): ServerTemplate | null => {
    const id = str(t.id, 64)
    const name = str(t.name)
    if (!id || !name) return null
    const usage = num(t.usage_count) ?? 0
    const created = typeof t.created_at === 'string' ? new Date(t.created_at) : null
    const fallback =
      source === 'mine' && created && !Number.isNaN(created.getTime())
        ? tr('server.template.created', { date: created.toLocaleDateString(dateLocale()) })
        : tr('server.template.used', { n: usage })
    return { id, name, description: str(t.description, 300) ?? fallback, data: parseTemplateData(t.template_data), source }
  }
  const list = (v: unknown, source: TemplateSource) =>
    (Array.isArray(v) ? (v as unknown[]) : [])
      .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
      .map(one(source))
      .filter((t): t is ServerTemplate => t !== null)
  const builtin = (Array.isArray(o.builtin) ? (o.builtin as unknown[]) : [])
    .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
    .flatMap((b) => {
      const id = BUILTIN_IDS.find((x) => x === b.id)
      return id
        ? [{ id, name: tr(`community.tpl.${id}` as Key), description: tr(`community.tpl.${id}.desc` as Key), data: parseTemplateData(b.template_data), source: 'builtin' as const }]
        : []
    })
  return { builtin, public: list(o.public, 'public'), mine: list(o.mine, 'mine') }
}

export const channelIcon = (type: string) => (type === 'voice' ? '🔊' : type === 'announcement' ? '📢' : '#')

/** Aperçu : salons sans catégorie, puis chaque catégorie (ordre des positions) ; rôles. */
export function templatePreview(data: TemplateData) {
  const byPos = <T extends { position?: number }>(a: T, b: T) => (a.position ?? 0) - (b.position ?? 0)
  const known = new Set(data.categories.map((c) => c.id).filter(Boolean))
  const loose = data.channels.filter((c) => !c.category_id || !known.has(c.category_id)).sort(byPos)
  const sections = [
    ...(loose.length ? [{ title: null as string | null, channels: loose }] : []),
    ...[...data.categories].sort(byPos).map((cat) => ({
      title: cat.name as string | null,
      channels: data.channels.filter((c) => c.category_id === cat.id).sort(byPos),
    })),
  ]
  return {
    sections,
    roles: [...data.roles].sort(byPos),
    channelCount: data.channels.length,
    categoryCount: data.categories.length,
  }
}

/** Longueur en octets UTF-8 (le serveur borne les noms avec len() en Rust, donc en octets). */
export function utf8Length(s: string): number {
  let n = 0
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4
  }
  return n
}

/** Message d'erreur du nom de serveur, ou null s'il est valide (2 à 100 octets, comme le serveur). */
export function serverNameError(name: string): string | null {
  const len = utf8Length(name.trim())
  return len < 2 || len > 100 ? tr('server.create.nameError') : null
}
