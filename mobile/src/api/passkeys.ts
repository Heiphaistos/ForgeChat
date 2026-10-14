import { http, path } from '@/lib/http'
import { createPasskey } from '@/lib/passkey'

export interface Passkey {
  id: string
  name: string
  created_at: string
  last_used_at: string | null
}

/** Code TOTP ou de secours : sans espaces, comme les autres appels 2FA (api/auth.ts). */
export const cleanCode = (code: string) => code.replace(/\s+/g, '')

export const passkeysApi = {
  list: () => http.get<Passkey[]>('/auth/passkeys'),

  /**
   * Ajout : le serveur exige le code 2FA dès `register/start`, puis la cérémonie système, puis
   * `register/finish`. Annulation par l'utilisateur : `PasskeyCancelled` (rien n'est enregistré).
   */
  async add(name: string, code: string): Promise<{ id: string; name: string }> {
    const options = await http.post<unknown>('/auth/passkeys/register/start', { code: cleanCode(code) }, { noQueue: true })
    const created = await createPasskey(options)
    return http.post('/auth/passkeys/register/finish', { name: name.trim(), ...created }, { noQueue: true })
  },

  /** Suppression : code 2FA dans le corps JSON. */
  remove: (id: string, code: string) =>
    http.delete<{ ok: boolean }>(path`/auth/passkeys/${id}`, { body: { code: cleanCode(code) }, noQueue: true }),
}
