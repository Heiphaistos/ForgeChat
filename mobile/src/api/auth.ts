import { z } from 'zod'
import { t } from '@/i18n'
import { ApiError, http } from '@/lib/http'
import type { AuthResponse, Session, User } from '@/types/models'
import type { WrappedKey } from '@/e2e/crypto'

const userSchema = z
  .object({
    id: z.string().uuid(),
    username: z.string(),
    discriminator: z.string(),
    avatar: z.string().nullable(),
    banner: z.string().nullable(),
    bio: z.string().nullable(),
    status: z.string(),
    custom_status: z.string().nullable(),
  })
  .passthrough()

const authSchema = z.object({
  access_token: z.string().min(20),
  refresh_token: z.string().min(32),
  user: userSchema,
})

export const authApi = {
  async login(email: string, password: string, totpCode?: string): Promise<AuthResponse> {
    try {
      const body: Record<string, string> = { email: email.trim().toLowerCase(), password }
      if (totpCode) body.totp_code = totpCode.replace(/\s+/g, '')
      return (await http.post('/auth/login', body, { auth: false, schema: authSchema })) as AuthResponse
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        throw new ApiError(401, t(totpCode ? 'auth.invalidTotp' : 'store.api.badCredentials'), 'bad_credentials')
      }
      throw e
    }
  },

  async register(username: string, email: string, password: string): Promise<AuthResponse> {
    return (await http.post(
      '/auth/register',
      { username: username.trim(), email: email.trim().toLowerCase(), password },
      { auth: false, schema: authSchema },
    )) as AuthResponse
  },

  /**
   * Déconnexion. `scope: 'current'` ne révoque que la session de cet appareil
   * (nécessite le patch serveur fourni) ; les serveurs non patchés révoquent tout.
   */
  logout(refreshToken: string | null, scope: 'current' | 'all' = 'current') {
    return http.post('/auth/logout', { refresh_token: refreshToken, scope }, { timeoutMs: 8000 })
  },

  me: () => http.get<User>('/users/me'),
  sessions: () => http.get<Session[]>('/users/me/sessions'),
  revokeSession: (id: string) => http.delete<void>(`/users/me/sessions/${encodeURIComponent(id)}`),
  /** `wrapped` : clé E2E ré-enveloppée avec le nouveau mot de passe (enregistrée dans la même transaction). */
  changePassword: (oldPassword: string, newPassword: string, wrapped: WrappedKey | null = null) =>
    http.post('/auth/change-password', { old_password: oldPassword, new_password: newPassword, wrapped }),

  /** Réponse identique que le compte existe ou non (le serveur ne révèle rien). */
  forgotPassword: (email: string) => http.post('/auth/forgot-password', { email: email.trim().toLowerCase() }, { auth: false }),
  /** Jeton à usage unique (30 min) reçu par e-mail ; révoque toutes les sessions. */
  resetPassword: (token: string, newPassword: string) =>
    http.post('/auth/reset-password', { token, new_password: newPassword }, { auth: false }),

  /** Double authentification (handlers/totp.rs). Le secret n'est actif qu'après `confirmTotp`. */
  setupTotp: () => http.post<TotpSetup>('/auth/2fa/setup'),
  confirmTotp: (code: string) => http.post<{ enabled: boolean }>('/auth/2fa/confirm', { code: code.replace(/\s+/g, '') }),
  /** Le serveur n'exige que le code TOTP (pas le mot de passe). */
  disableTotp: (code: string) => http.post<{ enabled: boolean }>('/auth/2fa/disable', { code: code.replace(/\s+/g, '') }),
}

export interface TotpSetup {
  secret: string
  /** otpauth://totp/… */
  qr_url: string
  backup_codes: string[]
}
