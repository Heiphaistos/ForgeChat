import { z } from 'zod'
import { t } from '@/i18n'
import { ApiError, http } from '@/lib/http'
import { deviceHeaders, rememberDevice } from '@/lib/deviceId'
import type { AuthResponse, Session, User } from '@/types/models'

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
  device_id: z.string().optional(),
})

export const authApi = {
  /**
   * Connexion v2 : `proof` = `{auth}` (compte migré) ou `{password, auth_new, kdf_salt_new}`
   * (dernière fois que le mot de passe part, le serveur migre le compte). Voir stores/auth.ts.
   */
  async login(email: string, proof: Record<string, string>, totpCode?: string): Promise<AuthResponse> {
    try {
      const body: Record<string, string> = { email: email.trim().toLowerCase(), ...proof }
      if (totpCode) body.totp_code = totpCode.replace(/\s+/g, '')
      const res = (await http.post('/auth/login', body, { auth: false, schema: authSchema, headers: await deviceHeaders() })) as AuthResponse
      await rememberDevice(res.device_id)
      return res
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        throw new ApiError(401, t(totpCode ? 'auth.invalidTotp' : 'store.api.badCredentials'), 'bad_credentials')
      }
      throw e
    }
  },

  /** Envoie un code à l'adresse (réponse identique si elle a déjà un compte) ; le compte naît à verifyEmail. */
  register: (username: string, email: string, auth: string, kdfSalt: string, inviteCode?: string) =>
    http.post<{ pending: boolean }>(
      '/auth/register',
      { username: username.trim(), email: email.trim().toLowerCase(), auth, kdf_salt: kdfSalt, kdf: 'argon2id', ...(inviteCode?.trim() ? { invite_code: inviteCode.trim() } : {}) },
      { auth: false },
    ),

  async verifyEmail(email: string, code: string): Promise<AuthResponse> {
    const res = (await http.post('/auth/verify-email', { email: email.trim().toLowerCase(), code: code.trim() }, { auth: false, schema: authSchema, headers: await deviceHeaders() })) as AuthResponse
    await rememberDevice(res.device_id)
    return res
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

  /** Réponse identique que le compte existe ou non (le serveur ne révèle rien). */
  forgotPassword: (email: string) => http.post('/auth/forgot-password', { email: email.trim().toLowerCase() }, { auth: false }),
  /** Jeton à usage unique (30 min) reçu par e-mail ; révoque toutes les sessions. */
  /** Le nouveau mot de passe ne part pas : sa preuve (`auth`) et son sel seulement (authKdf.ts). */
  resetPassword: (token: string, newAuth: string, newKdfSalt: string) =>
    http.post('/auth/reset-password', { token, new_auth: newAuth, new_kdf_salt: newKdfSalt, new_kdf: 'argon2id' }, { auth: false }),

  /** Double authentification (handlers/totp.rs). Le secret n'est actif qu'après `confirmTotp`. */
  setupTotp: () => http.post<TotpSetup>('/auth/2fa/setup'),
  confirmTotp: (code: string) => http.post<{ enabled: boolean }>('/auth/2fa/confirm', { code: code.replace(/\s+/g, '') }),
  /** Le serveur n'exige que le code TOTP (pas le mot de passe). */
  disableTotp: (code: string) => http.post<{ enabled: boolean }>('/auth/2fa/disable', { code: code.replace(/\s+/g, '') }),
  /** Codes de secours restants (jamais les codes eux-mêmes). */
  totpStatus: () => http.get<{ enabled: boolean; backup_codes_left: number }>('/auth/2fa/status'),
  /** Nouveaux codes de secours (les anciens sont invalidés) ; exige un code valide. */
  regenerateBackupCodes: (code: string) =>
    http.post<{ backup_codes: string[] }>('/auth/2fa/backup-codes', { code: code.replace(/\s+/g, '') }, { noQueue: true }),
  /** Verrouillage d'urgence : toutes les sessions fermées, nouveau mot de passe exigé. */
  panic: () => http.post<{ locked: boolean }>('/users/me/panic', {}, { noQueue: true }),
}

export interface TotpSetup {
  secret: string
  /** otpauth://totp/… */
  qr_url: string
  backup_codes: string[]
}
