/** Règles pures des écrans Compte / Sécurité / Confidentialité (testées dans __tests__/account-rules.test.ts). */
import { t } from '@/i18n'

/** Jeton de réinitialisation : 64 caractères alphanumériques (handlers/password_reset.rs). */
export const RESET_TOKEN_RE = /^[A-Za-z0-9]{64}$/

/**
 * Jeton depuis ce que l'utilisateur colle : le lien du mail (« …/reset-password#token=… »,
 * ou « ?token=… »), ou le jeton seul. null si rien de valide.
 */
export function extractResetToken(input: string | null | undefined): string | null {
  const s = (input ?? '').trim()
  if (RESET_TOKEN_RE.test(s)) return s
  const tok = s.match(/[#?&]token=([A-Za-z0-9]+)/)?.[1]
  return tok && RESET_TOKEN_RE.test(tok) ? tok : null
}

/** Pseudo : mêmes règles que le serveur (users::update_me). */
export function usernameError(name: string): string | null {
  const n = name.trim()
  if (n.length < 2 || n.length > 32) return t('settings.rules.usernameLength')
  if (!/^[\p{L}\p{N}_-]+$/u.test(n)) return t('settings.rules.usernameChars')
  return null
}

/**
 * Anniversaire saisi en « JJ/MM/AAAA » (ou « AAAA-MM-JJ ») → « AAAA-MM-JJ » attendu par le serveur.
 * Vide → null (effacer). Date impossible, future ou avant 1900 → erreur.
 */
export function parseBirthday(input: string, now = new Date()): { value: string | null } | { error: string } {
  const s = input.trim()
  if (!s) return { value: null }
  const fr = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const [y, m, d] = fr ? [+fr[3]!, +fr[2]!, +fr[1]!] : iso ? [+iso[1]!, +iso[2]!, +iso[3]!] : [0, 0, 0]
  const date = new Date(Date.UTC(y, m - 1, d))
  if (!y || date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return { error: t('settings.rules.birthdayInvalid') }
  }
  if (y < 1900 || date.getTime() > now.getTime()) return { error: t('settings.rules.birthdayRange') }
  return { value: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` }
}

/** « AAAA-MM-JJ » → « JJ/MM/AAAA » pour l'affichage ; '' si absent. */
export function formatBirthday(iso: string | null | undefined): string {
  const m = (iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

/** Heure « HH:MM » valide (heures calmes). */
export const isHHMM = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s.trim())

/** « 22:00:00 » (TIME Postgres) → « 22:00 » ; repli si absent. */
export const toHHMM = (t: string | null | undefined, fallback: string) => (t && /^\d{2}:\d{2}/.test(t) ? t.slice(0, 5) : fallback)

/** Clé TOTP lisible : groupes de 4 caractères. */
export const formatSecret = (secret: string) => secret.replace(/(.{4})(?=.)/g, '$1 ')

// ponytail: sans expo-file-system l'export est partagé comme texte ; au-delà, la feuille de partage
// Android échoue (limite Binder ~1 Mo). Ajouter expo-file-system + expo-sharing si les exports grossissent.
export const EXPORT_SHARE_MAX_CHARS = 400_000

/** Durée d'appel lisible : « 45 s », « 3 min 05 s », « 1 h 02 min ». */
export function formatCallDuration(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h) return `${h} h ${String(m).padStart(2, '0')} min`
  if (m) return `${m} min ${String(s).padStart(2, '0')} s`
  return `${s} s`
}

/** Barrière de vérification d'un serveur : même règle que le web (ChannelPage.tsx). */
export function needsVerification(detail: unknown): boolean {
  if (!detail || typeof detail !== 'object') return false
  const d = detail as { server?: { verification_enabled?: boolean }; member?: { verified_at?: string | null } | null }
  return !!d.server?.verification_enabled && !!d.member && d.member.verified_at == null
}
