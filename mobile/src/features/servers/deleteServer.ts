import { t } from '@/i18n'
import { ApiError } from '@/lib/http'

/** Le nom recopié doit correspondre, sans tenir compte des espaces autour ni de la casse. */
export const nameMatches = (typed: string, name: string) => typed.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase()

/** Corps de DELETE /servers/:id (servers.rs::ReauthBody) : le code 2FA n'est envoyé que s'il est saisi. */
export function deleteServerBody(password: string, totp: string): { password: string; totp_code?: string } {
  const code = totp.replace(/\s/g, '')
  return code ? { password, totp_code: code } : { password }
}

/** Erreur à afficher avant tout appel, ou null si la demande peut partir. */
export function deleteServerError(typedName: string, serverName: string, password: string, needTotp: boolean, totp: string): string | null {
  if (!nameMatches(typedName, serverName)) return t('server.deleteRules.typeName')
  if (!password) return t('settings.deleteRules.passwordRequired')
  if (needTotp && !totp.trim()) return t('server.deleteRules.totp')
  return null
}

/** Où et quoi afficher après un refus du serveur (servers.rs::verify_reauth). */
export function deleteServerFailure(e: unknown): { field: 'password' | 'totp' | 'form'; message: string; needTotp?: boolean } {
  if (!(e instanceof ApiError)) return { field: 'form', message: t('server.deleteRules.failedRetry') }
  if (e.status === 403 && e.code === 'totp_required')
    return { field: 'totp', message: t('server.deleteRules.totp'), needTotp: true }
  if (e.status === 400 && /double authentification/i.test(e.message)) return { field: 'totp', message: e.message, needTotp: true }
  if (e.status === 400 && /mot de passe/i.test(e.message)) return { field: 'password', message: e.message }
  if (e.status === 429) return { field: 'form', message: t('settings.deleteRules.tooMany') }
  if (e.status === 403) return { field: 'form', message: t('server.deleteRules.ownerOnly') }
  if (e.status === 0) return { field: 'form', message: t('settings.deleteRules.network') }
  if (e.status === 400 && e.message) return { field: 'form', message: e.message }
  return { field: 'form', message: t('server.deleteRules.failedLater') }
}
