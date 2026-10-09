// Préférences de la page Actualités, propres à chaque compte et synchronisées entre le web, le PC et le
// téléphone : le serveur fait foi (/users/me/news-prefs, même JSON que le web), ce store persistant sert
// de cache pour l'affichage immédiat. Chaque changement part au serveur après 800 ms sans autre changement.
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { http, errorMessage } from '@/lib/http'
import { logger } from '@/lib/logger'
import { secureStateStorage } from '@/lib/secureStorage'
import { useAuth } from '@/stores/auth'
import { useSettings } from '@/stores/settings'
import { sanitizePrefs, type NewsPrefs } from './logic'

const URL = '/users/me/news-prefs'
const DEBOUNCE_MS = 800

interface NewsPrefsState {
  prefs: NewsPrefs
  /** Ancien ordre local (settings.newsOrder) déjà repris. */
  migrated: boolean
  /** Compte à qui appartiennent ces préférences (un autre compte repart des valeurs par défaut). */
  owner: string | null
  update: (patch: Partial<NewsPrefs>) => void
}

export const useNewsPrefs = create<NewsPrefsState>()(
  persist(
    (set) => ({
      prefs: sanitizePrefs({}),
      migrated: false,
      owner: null,
      update: (patch) => set((s) => ({ prefs: sanitizePrefs({ ...s.prefs, ...patch }) })),
    }),
    {
      name: 'fc.newsPrefs.v1',
      storage: createJSONStorage(() => secureStateStorage),
      // SecureStore plafonne vers 2 Ko : seul le thème est gardé ici (affichage immédiat), le reste
      // (épinglées, sources coupées…) vient du serveur, qui fait foi.
      partialize: ({ prefs, migrated, owner }) => ({ theme: prefs.theme, migrated, owner }),
      merge: (saved, cur) => {
        const s = (saved ?? {}) as { theme?: unknown; migrated?: unknown; owner?: unknown }
        return { ...cur, prefs: sanitizePrefs({ theme: s.theme }), migrated: s.migrated === true, owner: typeof s.owner === 'string' ? s.owner : null }
      },
    },
  ),
)

type Persisted = { persist: { hasHydrated: () => boolean; onFinishHydration: (fn: () => void) => () => void } }
const hydrated = (store: Persisted) =>
  store.persist.hasHydrated()
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        const off = store.persist.onFinishHydration(() => {
          off()
          resolve()
        })
      })

// Dernier JSON connu du serveur (envoyé ou reçu) ; tant que le serveur n'a pas répondu, rien n'est envoyé
// (hors ligne : le cache local s'affiche sans écraser les réglages faits ailleurs).
let loaded = false
let sent = ''
let timer: ReturnType<typeof setTimeout> | undefined

const put = (p: NewsPrefs) => {
  sent = JSON.stringify(p)
  return http.put(URL, p).then(
    () => undefined,
    (e: unknown) => logger.warn('news', 'préférences non envoyées', errorMessage(e)),
  )
}

/** Une seule fois : l'ordre des rubriques réglé avant la synchronisation (appui long) devient celui des préférences. */
function migrateOldOrder() {
  const s = useNewsPrefs.getState()
  if (s.migrated) return
  const old = useSettings.getState().newsOrder
  useNewsPrefs.setState({ migrated: true, ...(old.length && !s.prefs.order.length ? { prefs: sanitizePrefs({ ...s.prefs, order: old }) } : {}) })
  if (old.length) useSettings.getState().set({ newsOrder: [] })
}

/** Lit les préférences du compte (à l'ouverture des Actualités) ; rien en ligne : celles de l'appareil deviennent la référence. */
export async function loadNewsPrefs(): Promise<void> {
  await Promise.all([hydrated(useNewsPrefs), hydrated(useSettings)])
  forOwner(useAuth.getState().user?.id ?? null)
  migrateOldOrder()
  let data: unknown
  try {
    data = await http.get<unknown>(URL)
  } catch (e) {
    logger.info('news', 'préférences en ligne indisponibles', errorMessage(e))
    return
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const p = sanitizePrefs(data)
    sent = JSON.stringify(p)
    loaded = true
    useNewsPrefs.setState({ prefs: p })
  } else {
    loaded = true
    await put(useNewsPrefs.getState().prefs)
  }
}

/** Préférences d'un autre compte : on repart de zéro et rien n'est envoyé avant d'avoir lu celles du compte. */
function forOwner(uid: string | null) {
  if (useNewsPrefs.getState().owner === uid) return
  resetNewsPrefsSync()
  useNewsPrefs.setState({ prefs: sanitizePrefs({}), owner: uid })
}
useAuth.subscribe((s, prev) => {
  if (s.user?.id !== prev.user?.id && useNewsPrefs.getState().owner !== null) forOwner(s.user?.id ?? null)
})

useNewsPrefs.subscribe((s, prev) => {
  if (s.prefs === prev.prefs || !loaded) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = undefined
    const p = useNewsPrefs.getState().prefs
    if (JSON.stringify(p) !== sent) void put(p)
  }, DEBOUNCE_MS)
})

/** Tests : repart d'un état neuf (pas encore lu du serveur). */
export function resetNewsPrefsSync() {
  loaded = false
  sent = ''
  if (timer) clearTimeout(timer)
  timer = undefined
}
