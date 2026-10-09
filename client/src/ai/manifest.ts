// Modèles de l'IA sur l'appareil (docs/IA-SUR-APPAREIL.md). Source unique : models.json,
// lu aussi par deploy/ai-models-fetch.sh qui les dépose sur notre serveur (/ai-models/).
// Chaque fichier est vérifié par SHA-256 avant d'être gardé ou utilisé.
import models from './models.json' with { type: 'json' }

export interface AiFile { path: string; size: number; sha256: string; src: string }
export interface AiPack { repo?: string; revision?: string; license: string; files: AiFile[] }

export const PACKS = models.packs as Record<string, AiPack>
export type PackId = 'runtime' | 'whisper' | 'whisper-small' | 'romance-en' | 'en-romance' | 'de-en' | 'en-de'
/** Modèles de transcription : whisper (base, rapide) pour les sous-titres en direct, whisper-small (précis) pour les vocaux. */
export type AsrPack = 'whisper' | 'whisper-small'

/** Langues proposées pour la traduction (au moins fr/en/es/de/it/pt). */
export const AI_LANGS = ['fr', 'en', 'es', 'de', 'it', 'pt'] as const
export type AiLang = (typeof AI_LANGS)[number]
export const isAiLang = (l: string | null | undefined): l is AiLang => !!l && (AI_LANGS as readonly string[]).includes(l)

export const packSize = (ids: readonly PackId[]) =>
  [...new Set(ids)].reduce((n, id) => n + PACKS[id].files.reduce((m, f) => m + f.size, 0), 0)

/** Fichier d'un pack demandé par le moteur (`<repo>/<fichier>`), sinon null. */
export function fileByPath(path: string): AiFile | null {
  for (const p of Object.values(PACKS)) for (const f of p.files) if (f.path === path) return f
  return null
}

export interface Step { pack: PackId; prefix: string }

/**
 * Étapes de traduction src → tgt. Opus-MT : modèles par paire, on passe par l'anglais
 * quand ni la source ni la cible ne l'est (ex. es → de = romance-en puis en-de).
 */
export function planTranslation(src: AiLang, tgt: AiLang): Step[] {
  if (src === tgt) return []
  const steps: Step[] = []
  if (src !== 'en') steps.push({ pack: src === 'de' ? 'de-en' : 'romance-en', prefix: '' })
  if (tgt !== 'en') steps.push(tgt === 'de' ? { pack: 'en-de', prefix: '' } : { pack: 'en-romance', prefix: `>>${tgt}<< ` })
  return steps
}

/** Packs à télécharger pour une traduction (moteur compris). */
export const packsFor = (steps: Step[]): PackId[] => steps.length ? ['runtime', ...steps.map(s => s.pack)] : []
