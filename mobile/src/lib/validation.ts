/** Validation côté client — miroir des règles serveur (handlers/auth.rs). */
import { t } from '@/i18n'

export const USERNAME_RE = /^[\p{L}\p{N}_-]{2,32}$/u
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
export const INVITE_CODE_RE = /^[A-Za-z0-9_-]{2,64}$/

export function validateRegistration(v: { username: string; email: string; password: string; confirm: string }) {
  const errors: Record<string, string> = {}
  const username = v.username.trim()
  if (!USERNAME_RE.test(username)) errors.username = t('auth.usernameRule')
  if (!EMAIL_RE.test(v.email.trim())) errors.email = t('auth.invalidEmail')
  if (v.password.length < 8) errors.password = t('auth.passwordMin')
  else if (v.password.length > 128) errors.password = t('auth.passwordMax')
  else if (passwordStrength(v.password).score < 2) errors.password = t('auth.passwordWeak')
  if (v.confirm !== v.password) errors.confirm = t('auth.passwordMismatch')
  return errors
}

/** Estimation simple de robustesse (0–4). */
export function passwordStrength(pw: string): { score: number; label: string } {
  if (!pw) return { score: 0, label: '' }
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length
  if (classes >= 2) score++
  if (classes >= 3 && pw.length >= 10) score++
  if (/^(.)\1+$/.test(pw) || /^(password|motdepasse|azerty|qwerty|123456)/i.test(pw)) score = 1
  score = Math.min(4, score)
  return { score, label: t((['auth.strength0', 'auth.strength1', 'auth.strength2', 'auth.strength3', 'auth.strength4'] as const)[score]!) }
}

/** Extrait le code d'un lien d'invitation (https://hôte/invite/CODE) ou d'un code brut. */
export function extractInviteCode(input: string): string | null {
  const s = input.trim()
  const m = s.match(/\/invite\/([A-Za-z0-9_-]{2,64})\/?$/)
  const code = m ? m[1]! : s
  return INVITE_CODE_RE.test(code) ? code : null
}
