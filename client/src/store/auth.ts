import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import api from '../api/client'
import { clearLocalSession, migrateLegacySession, resumeSession, storeSession } from '../lib/localSession'
import { useChat, useDraft } from './chat'
import { usePresence } from './presence'
import { useUnread } from './unread'
import { useWs } from './ws'
import { useChannelNotif, EMPTY_NOTIF_STATE } from './channelNotif'
import { disableWebPush } from '../utils/webPush'
import { listAccounts } from '../lib/accounts'
import { forgetOfflineData } from '../lib/offline'
import { queryClient } from '../main'
import { clearAccountKey, prelogin, rememberLogin, upgradeKdf } from '../e2e/accountKey'
import { asKdf, deriveSecrets, newKdfSalt, passwordProblem } from '../e2e/authKdf'
import { pwnedProblem } from '../e2e/pwned'
import { clearSearchIndex } from '../e2e/searchIndex'
import { guardArgon, markMigrated, markUserMigrated } from '../e2e/authGuard'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

interface User {
  id: string
  username: string
  discriminator: string
  avatar: string | null
  banner: string | null
  banner_url?: string
  bio: string | null
  status: string
  custom_status: string | null
  custom_status_emoji?: string | null
  custom_status_expires_at?: string | null
  display_name?: string | null
  /** Activité (jeu détecté, musique saisie à la main…). */
  activity_type?: string | null
  activity_name?: string | null
  email?: string
  focus_mode?: boolean
  verified?: boolean
}

interface AuthState {
  user: User | null
  loading: boolean
  login: (email: string, password: string, totpCode?: string) => Promise<void>
  /** Envoie le code de vérification ; le compte naît à /verify-email. */
  register: (username: string, email: string, password: string, inviteCode?: string) => Promise<void>
  logout: () => Promise<void>
  fetchMe: () => Promise<void>
  updateMe: (data: Partial<User>) => void
}

export const useAuth = create<AuthState>()(
  immer((set) => ({
    user: null,
    loading: true,

    login: async (email, password, totpCode) => {
      // Connexion v2 : seul `auth` part. Compte pas encore migré : le mot de passe part une
      // dernière fois avec la nouvelle preuve, et le serveur bascule le compte.
      const pre = await prelogin(email)
      const salt = pre.legacy || !pre.kdf_salt ? newKdfSalt() : pre.kdf_salt
      // Compte v1 qui migre : directement en Argon2id. Sinon : la dérivation du compte.
      const kdf = pre.legacy ? 'argon2id' : asKdf(pre.kdf)
      let secrets = await deriveSecrets(password, salt, kdf)
      let body: Record<string, string> | null = pre.legacy
        ? { email, password, auth_new: secrets.auth, kdf_salt_new: salt, kdf_new: 'argon2id' }
        : { email, auth: secrets.auth }
      if (totpCode) body.totp_code = totpCode
      let data: any
      try {
        data = (await api.post('/auth/login', body)).data
      } catch (err) {
        secrets.wrapKey.fill(0)
        throw err
      } finally {
        body = null
      }
      void markMigrated(email) // anti-retour arrière (e2e/authGuard.ts)
      if (typeof data?.user?.id === 'string') void markUserMigrated(data.user.id)
      // Web : jetons dans les cookies HttpOnly (automatiques via withCredentials)
      // Tauri : accès en mémoire, rafraîchissement dans le trousseau de l'OS (côté Rust)
      if (isTauri) await storeSession(data.access_token, data.refresh_token)
      // Compte encore en PBKDF2 : bascule vers Argon2id tant que le mot de passe est là (audit M3).
      if (kdf === 'pbkdf2' && typeof data?.user?.id === 'string') {
        const upgraded = await upgradeKdf(data.user.id, password, secrets, email)
        if (upgraded) { secrets.wrapKey.fill(0); secrets = upgraded }
      } else if (kdf === 'argon2id' && typeof data?.user?.id === 'string') {
        void guardArgon(`user|${data.user.id}`, 'argon2id')
      }
      rememberLogin(password, secrets)
      set(s => { s.user = data.user })
    },

    register: async (username, email, password, inviteCode) => {
      const problem = passwordProblem(password, [username, email]) ?? await pwnedProblem(password)
      if (problem) throw new Error(problem)
      const kdf_salt = newKdfSalt()
      const secrets = await deriveSecrets(password, kdf_salt, 'argon2id')
      try {
        await api.post('/auth/register', {
          username, email, auth: secrets.auth, kdf_salt, kdf: 'argon2id', ...(inviteCode?.trim() ? { invite_code: inviteCode.trim() } : {}),
        })
      } catch (err) {
        secrets.wrapKey.fill(0)
        throw err
      }
      // Gardé en mémoire jusqu'à la création de la clé, après la vérification de l'adresse.
      rememberLogin(password, secrets)
    },

    logout: async () => {
      // Avant la déconnexion (route authentifiée) : ce navigateur ne doit plus
      // recevoir les notifications push de ce compte.
      await disableWebPush((await listAccounts()).length > 0)
      await api.post('/auth/logout', {}).catch(() => {})
      if (isTauri) await clearLocalSession()
      const uid = useAuth.getState().user?.id
      await clearAccountKey(uid)
      if (uid) await forgetOfflineData(uid)
      // Aucun texte déchiffré ne reste sur l'appareil : index de recherche et brouillons (resynchronisés à la connexion).
      await clearSearchIndex()
      useDraft.setState({ drafts: {} })
      useWs.getState().disconnect()
      useChat.setState({ messagesByChannel: {}, typing: {} })
      usePresence.setState({ statuses: {}, activities: {} })
      useUnread.getState().clearAll()
      useChannelNotif.setState(EMPTY_NOTIF_STATE)
      set(s => { s.user = null })
      // Sans ça, le compte suivant connecté dans le même onglet voit les serveurs,
      // MP et amis du précédent tant que le cache n'est pas périmé.
      queryClient.clear()
    },

    fetchMe: async () => {
      // Web : le cookie httpOnly est envoyé automatiquement
      // Tauri : le Bearer token est injecté par l'interceptor axios. Sans jeton d'accès en
      // mémoire, Rust rafraîchit depuis le trousseau ; aucun jeton enregistré = pas de session.
      if (isTauri) {
        await migrateLegacySession()
        // Jamais de /users/me sans jeton : son 401 passait pour un refus et effaçait la session.
        if (!(await resumeSession())) { set(s => { s.loading = false }); return }
      }
      // Réseau instable au lancement (réveil de veille, Wi-Fi qui s'accroche) : on réessaie un peu avant
      // d'abandonner, et on ne touche JAMAIS à la session sur une simple erreur réseau.
      for (let attempt = 0; ; attempt++) {
        try {
          const { data } = await api.get('/users/me')
          set(s => { s.user = data; s.loading = false })
          return
        } catch (err: any) {
          const status = err?.response?.status
          if ((status === 401 || status === 403) && !err?.sessionKept) {
            // Refus définitif (l'intercepteur a déjà tenté le rafraîchissement).
            if (isTauri) await clearLocalSession()
            break
          }
          if (attempt >= 3) {
            // Toujours injoignable : l'écran de connexion s'affiche, la session reste enregistrée et
            // reprend toute seule au retour du réseau (voir l'écouteur « online » plus bas).
            break
          }
          await new Promise(r => setTimeout(r, 1500 * (attempt + 1)))
        }
      }
      set(s => { s.loading = false })
    },

    updateMe: (data) => set(s => { if (s.user) Object.assign(s.user, data) }),
  }))
)

// Bureau : la session enregistrée reprend d'elle-même quand le réseau revient (lancement hors ligne).
if (isTauri && typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    const { user, fetchMe } = useAuth.getState()
    if (!user) void fetchMe()
  })
}
