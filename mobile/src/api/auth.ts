import { z } from 'zod'
import { ApiError, http } from '@/lib/http'
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
})

export const authApi = {
  async login(email: string, password: string, totpCode?: string): Promise<AuthResponse> {
    try {
      const body: Record<string, string> = { email: email.trim().toLowerCase(), password }
      if (totpCode) body.totp_code = totpCode.replace(/\s+/g, '')
      return (await http.post('/auth/login', body, { auth: false, schema: authSchema })) as AuthResponse
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        throw new ApiError(401, totpCode ? 'Code 2FA invalide.' : 'Email ou mot de passe incorrect.', 'bad_credentials')
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
  changePassword: (oldPassword: string, newPassword: string) =>
    http.post('/auth/change-password', { old_password: oldPassword, new_password: newPassword }),
}
