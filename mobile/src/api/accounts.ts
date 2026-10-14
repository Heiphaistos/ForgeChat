import { normalizeAccounts, type ConnectedAccount } from '@/features/account/connectedAccounts'
import { http, path } from '@/lib/http'

export const accountsKey = ['connected-accounts'] as const

/** Comptes liés de l'utilisateur (handlers/user_settings.rs, connections.rs::set_visibility). */
export const accountsApi = {
  async list(): Promise<ConnectedAccount[]> {
    return normalizeAccounts(await http.get<unknown>('/user/connected-accounts'))
  },
  add: (body: { platform: string; platform_username: string; platform_url: string | null }) => http.post('/user/connected-accounts', body),
  remove: (platform: string) => http.delete(path`/user/connected-accounts/${platform}`),
  setVisible: (platform: string, visible: boolean) => http.patch(path`/user/connected-accounts/${platform}`, { visible }),
}
