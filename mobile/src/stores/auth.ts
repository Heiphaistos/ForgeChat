import { create } from 'zustand'
import { authApi } from '@/api/auth'
import { ensureAccessToken, onSessionExpired } from '@/lib/http'
import { logger } from '@/lib/logger'
import { queryClient } from '@/lib/queryClient'
import { realtime } from '@/lib/realtime'
import { tokens } from '@/lib/tokens'
import type { AuthResponse, User } from '@/types/models'
import { usePresence } from './presence'
import { useTyping } from './typing'
import { useUi } from './ui'
import { useUnread } from './unread'
import { classifyBootstrapFailure, SESSION_EXPIRED_NOTICE } from '@/lib/sessionNotice'
import { t } from '@/i18n'

/**
 * Cycle de vie de la session.
 *
 *  booting ──(refresh OK)──▶ signedIn
 *     │  └──(pas de token / refresh refusé)──▶ signedOut
 *     └──(réseau KO)──▶ offline (bouton « Réessayer »)
 */
export type AuthStatus = 'booting' | 'signedOut' | 'signedIn' | 'offline'

type Hook = () => void | Promise<void>
const signOutHooks = new Set<Hook>()
const preSignOutHooks = new Set<Hook>()
/**
 * Exécutés AVANT la révocation serveur, tant que la session est encore valide
 * (ex. désinscription du token push). Ignorés si la session a déjà expiré.
 */
export function registerPreSignOutHook(fn: Hook): () => void {
  preSignOutHooks.add(fn)
  return () => preSignOutHooks.delete(fn)
}
/** Les modules (appels, vocal, push…) s'enregistrent pour nettoyer à la déconnexion. */
export function registerSignOutHook(fn: Hook): () => void {
  signOutHooks.add(fn)
  return () => signOutHooks.delete(fn)
}

interface AuthState {
  status: AuthStatus
  user: User | null
  /** Motif de la dernière déconnexion forcée (affiché sur l'écran de login). */
  notice: string | null
  bootstrap: () => Promise<void>
  login: (email: string, password: string, totpCode?: string) => Promise<void>
  register: (username: string, email: string, password: string) => Promise<void>
  logout: (scope?: 'current' | 'all') => Promise<void>
  /** Fin de session sans appel serveur (session déjà révoquée côté serveur). */
  signOutLocally: (notice?: string) => Promise<void>
  setUser: (patch: Partial<User>) => void
  clearNotice: () => void
}

async function wipeLocal() {
  realtime.stop()
  await Promise.allSettled([...signOutHooks].map(async (h) => h()))
  await tokens.clear()
  queryClient.clear()
  usePresence.getState().reset()
  useUnread.getState().reset()
  useTyping.getState().reset()
  useUi.getState().reset()
}

export const useAuth = create<AuthState>((set, get) => {
  const acceptSession = async (res: AuthResponse) => {
    await tokens.setRefreshToken(res.refresh_token)
    await tokens.setUserId(res.user.id)
    tokens.setAccessToken(res.access_token)
    queryClient.setQueryData(['me'], res.user)
    set({ status: 'signedIn', user: res.user, notice: null })
    realtime.start()
  }

  return {
    status: 'booting',
    user: null,
    notice: null,

    bootstrap: async () => {
      set({ status: 'booting' })
      const refresh = await tokens.getRefreshToken()
      if (!refresh) {
        set({ status: 'signedOut', user: null })
        return
      }
      try {
        await ensureAccessToken()
        const me = await authApi.me()
        queryClient.setQueryData(['me'], me)
        set({ status: 'signedIn', user: me })
        realtime.start()
      } catch (e) {
        if (classifyBootstrapFailure(e) === 'retry') {
          set({ status: 'offline' })
        } else {
          logger.warn('auth', 'bootstrap refusé', e)
          await wipeLocal()
          set({ status: 'signedOut', user: null, notice: t(SESSION_EXPIRED_NOTICE) })
        }
      }
    },

    login: async (email, password, totpCode) => {
      const res = await authApi.login(email, password, totpCode)
      await acceptSession(res)
    },

    register: async (username, email, password) => {
      const res = await authApi.register(username, email, password)
      await acceptSession(res)
    },

    logout: async (scope = 'current') => {
      await Promise.allSettled([...preSignOutHooks].map(async (h) => h()))
      const refresh = await tokens.getRefreshToken()
      try {
        // Révocation serveur AVANT l'effacement local (le Bearer est encore valide).
        await authApi.logout(refresh, scope)
      } catch (e) {
        logger.warn('auth', 'logout serveur impossible (effacement local quand même)', e)
      }
      await wipeLocal()
      set({ status: 'signedOut', user: null })
    },

    signOutLocally: async (notice) => {
      await wipeLocal()
      set({ status: 'signedOut', user: null, notice: notice ?? null })
    },

    setUser: (patch) => {
      const u = get().user
      if (!u) return
      const next = { ...u, ...patch }
      queryClient.setQueryData(['me'], next)
      set({ user: next })
    },

    clearNotice: () => set({ notice: null }),
  }
})

// Refresh définitivement refusé (révoqué depuis un autre appareil, mot de passe changé…)
onSessionExpired(() => {
  if (useAuth.getState().status !== 'signedIn') return
  void wipeLocal().then(() =>
    useAuth.setState({ status: 'signedOut', user: null, notice: t('store.session.revoked') }),
  )
})

export const getMyId = () => useAuth.getState().user?.id ?? null
