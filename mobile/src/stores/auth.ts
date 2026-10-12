import { create } from 'zustand'
import { authApi } from '@/api/auth'
import { ApiError, backoffMs, ensureAccessToken, onSessionExpired } from '@/lib/http'
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
import { clearAccountKey, prelogin, rememberLogin, upgradeKdf } from '@/e2e/accountKey'
import { asKdf, deriveSecrets, newKdfSalt, passwordProblem } from '@/e2e/authKdf'
import { pwnedProblem } from '@/e2e/pwned'
import { guardArgon, markMigrated, markUserMigrated } from '@/e2e/authGuard'
import { forgetOfflineData, setOfflineOwner } from '@/lib/offline'
import { listAccounts, putAccount, takeAccount } from '@/lib/accounts'

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
  /** Envoie le code de vérification ; le compte naît à `verifyEmail`. */
  register: (username: string, email: string, password: string, inviteCode?: string) => Promise<void>
  verifyEmail: (email: string, code: string) => Promise<void>
  logout: (scope?: 'current' | 'all') => Promise<void>
  /** Fin de session sans appel serveur (session déjà révoquée côté serveur). */
  signOutLocally: (notice?: string) => Promise<void>
  setUser: (patch: Partial<User>) => void
  clearNotice: () => void
  /** Met le compte actif de côté (il reste connecté) pour se connecter à un autre. */
  addAccount: () => Promise<void>
  /** Passe sur un compte mis de côté ; false s'il est inconnu ou si sa session a expiré. */
  switchAccount: (id: string) => Promise<boolean>
}

/** Nouveaux essais automatiques du démarrage après un 503 (backoff). */
let bootRetries = 0

/** `keep` : changement de compte, la clé E2E et les données hors ligne du compte restent. */
async function wipeLocal(keep = false) {
  const uid = useAuth.getState().user?.id ?? (await tokens.getUserId())
  realtime.stop()
  await Promise.allSettled([...signOutHooks].map(async (h) => h()))
  await tokens.clear()
  await clearAccountKey(uid, keep)
  if (uid && !keep) await forgetOfflineData(uid)
  else await setOfflineOwner(null)
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
    await setOfflineOwner(res.user.id)
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
        await setOfflineOwner(await tokens.getUserId())
        // Sans réseau : la session continue sur les données gardées (lib/offline) si elles existent.
        // 503 (le serveur refuse par sécurité) : pareil, jamais de déconnexion.
        await ensureAccessToken().catch((e: unknown) => {
          if (!(e instanceof ApiError && (e.isNetwork || e.status === 503))) throw e
        })
        const me = await authApi.me()
        queryClient.setQueryData(['me'], me)
        bootRetries = 0
        set({ status: 'signedIn', user: me })
        realtime.start()
      } catch (e) {
        if (classifyBootstrapFailure(e) === 'retry') {
          set({ status: 'offline' })
          // 503 : nouvel essai automatique avec backoff (5 s → 60 s), jetons et clé gardés.
          if (e instanceof ApiError && e.status === 503) {
            setTimeout(() => { if (get().status === 'offline') void get().bootstrap() }, Math.max(5000, backoffMs(bootRetries++)))
          }
        } else {
          logger.warn('auth', 'bootstrap refusé', e)
          await wipeLocal()
          set({ status: 'signedOut', user: null, notice: t(SESSION_EXPIRED_NOTICE) })
        }
      }
    },

    login: async (email, password, totpCode) => {
      // Connexion v2 : seul `auth` part. Compte pas encore migré : le mot de passe part une
      // dernière fois avec la nouvelle preuve, et le serveur bascule le compte.
      const pre = await prelogin(email)
      const salt = pre.legacy || !pre.kdf_salt ? newKdfSalt() : pre.kdf_salt
      // Compte v1 qui migre : directement en Argon2id. Sinon : la dérivation du compte.
      const kdf = pre.legacy ? 'argon2id' : asKdf(pre.kdf)
      let secrets = await deriveSecrets(password, salt, kdf)
      let res: AuthResponse
      try {
        res = await authApi.login(
          email,
          pre.legacy ? { password, auth_new: secrets.auth, kdf_salt_new: salt, kdf_new: 'argon2id' } : { auth: secrets.auth },
          totpCode,
        )
      } catch (e) {
        secrets.wrapKey.fill(0)
        throw e
      }
      // Compte encore en PBKDF2 : bascule vers Argon2id tant que le mot de passe est là (audit M3).
      // Jeton d'accès posé d'abord : la bascule est une requête authentifiée.
      if (kdf === 'pbkdf2') {
        tokens.setAccessToken(res.access_token)
        const upgraded = await upgradeKdf(res.user.id, password, secrets, email)
        if (upgraded) { secrets.wrapKey.fill(0); secrets = upgraded }
      } else {
        void guardArgon(`user|${res.user.id}`, 'argon2id')
      }
      rememberLogin(password, secrets)
      void markMigrated(email) // anti-retour arrière (e2e/authGuard.ts)
      void markUserMigrated(res.user.id)
      await acceptSession(res)
    },

    register: async (username, email, password, inviteCode) => {
      const problem = passwordProblem(password, [username, email]) ?? await pwnedProblem(password)
      if (problem) throw new Error(problem)
      const kdfSalt = newKdfSalt()
      const secrets = await deriveSecrets(password, kdfSalt, 'argon2id')
      try {
        await authApi.register(username, email, secrets.auth, kdfSalt, inviteCode)
      } catch (e) {
        secrets.wrapKey.fill(0)
        throw e
      }
      // Gardé en mémoire jusqu'à la création de la clé, après la vérification de l'adresse.
      rememberLogin(password, secrets)
    },

    verifyEmail: async (email, code) => {
      const res = await authApi.verifyEmail(email, code)
      void markUserMigrated(res.user.id) // compte né en v2 : anti-retour arrière (e2e/authGuard.ts)
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

    addAccount: async () => {
      const u = get().user
      const refresh = await tokens.getRefreshToken()
      if (!u || !refresh) return
      await putAccount({ id: u.id, username: u.username, avatar: u.avatar }, refresh)
      await wipeLocal(true)
      set({ status: 'signedOut', user: null, notice: null })
    },

    switchAccount: async (id) => {
      if (!(await listAccounts()).some((a) => a.id === id)) return false
      const u = get().user
      const current = await tokens.getRefreshToken()
      if (u && current) await putAccount({ id: u.id, username: u.username, avatar: u.avatar }, current).catch(() => undefined)
      if (u) await wipeLocal(true)
      const token = await takeAccount(id)
      if (!token) {
        set({ status: 'signedOut', user: null })
        return false
      }
      await tokens.setRefreshToken(token)
      await tokens.setUserId(id)
      await get().bootstrap()
      return get().status === 'signedIn'
    },
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
