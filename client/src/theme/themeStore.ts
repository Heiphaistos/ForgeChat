import { create } from 'zustand'
import api from '../api/client'
import {
  DEFAULT_SPEC, DEFAULT_THEME_ID, findTheme, isHex, sanitizeCustomList, withAccent,
  type CustomTheme, type ThemeSpec,
} from './themeCore'
import { applyLayoutToDom, applyThemeToDom, DEFAULT_LAYOUT, sanitizeLayout, type LayoutPrefs } from './applyTheme'
import {
  applyCategoryToDom, DEFAULT_CATEGORY, sanitizeCategory, sanitizeServerLooks, type CategoryStyle, type ServerLook,
} from './serverLook'

/**
 * Thème actif, thèmes perso et disposition. Stockés dans ce navigateur ET sur le compte
 * (/user/theme pour le thème actif, /user/theme-studio pour les thèmes perso, la disposition, le style
 * des catégories et l'apparence propre à chaque serveur) :
 * web, bureau et téléphone partagent les mêmes choix.
 */
export type Density = 'ultra-compact' | 'compact' | 'normal' | 'comfortable'
const DENSITIES: Density[] = ['ultra-compact', 'compact', 'normal', 'comfortable']
export const asDensity = (v: unknown): Density => (DENSITIES.includes(v as Density) ? (v as Density) : 'normal')

interface ThemeState {
  activeId: string
  customs: CustomTheme[]
  layout: LayoutPrefs
  /** accent_color du compte : remplace l'accent des thèmes prédéfinis (les thèmes perso gardent le leur). */
  accent: string | null
  /** Thème en cours d'édition, affiché en direct à la place du thème actif. */
  preview: ThemeSpec | null
  /** Densité des messages (interface_density du compte). */
  density: Density
  /** Style des en-têtes de catégorie partout où un serveur n'a pas le sien. */
  category: CategoryStyle
  /** Apparence choisie pour certains serveurs (thème, catégories), par id de serveur. */
  servers: Record<string, ServerLook>
  /** Serveur affiché (null hors serveur) : son apparence remplace celle de ForgeChat. */
  serverId: string | null
  select: (id: string) => void
  upsertCustom: (t: CustomTheme) => void
  removeCustom: (id: string) => void
  setLayout: (patch: Partial<LayoutPrefs>) => void
  setAccent: (accent: string | null) => void
  setPreview: (spec: ThemeSpec | null) => void
  setDensity: (d: Density) => void
  setCategory: (patch: Partial<CategoryStyle>) => void
  /** null = ce serveur reprend l'apparence de ForgeChat. */
  setServerLook: (serverId: string, look: ServerLook | null) => void
  setServerId: (serverId: string | null) => void
  loadRemote: () => Promise<void>
}

const THEME_KEY = 'fc_theme'
const STUDIO_KEY = 'fc_theme_studio'
/** Au-delà, les images locales (base64) ne partent pas sur le compte : elles restent sur cet appareil. */
const SYNC_BUDGET = 900_000

type Studio = { customs: CustomTheme[]; layout: LayoutPrefs; category: CategoryStyle; servers: Record<string, ServerLook> }

function readLocal(): Studio & { activeId: string; density: Density } {
  let raw: Record<string, unknown> = {}
  let activeId = DEFAULT_THEME_ID
  let density: Density = 'normal'
  try {
    activeId = localStorage.getItem(THEME_KEY) || DEFAULT_THEME_ID
    density = asDensity(localStorage.getItem('fc_density'))
    const parsed: unknown = JSON.parse(localStorage.getItem(STUDIO_KEY) ?? '{}')
    if (parsed && typeof parsed === 'object') raw = parsed as Record<string, unknown>
  } catch { /* stockage indisponible ou corrompu : valeurs par défaut */ }
  return { activeId, density, ...sanitizeStudio(raw) }
}

function sanitizeStudio(raw: Record<string, unknown>): Studio {
  return {
    customs: sanitizeCustomList(raw.customs),
    layout: sanitizeLayout(raw.layout),
    category: raw.category ? sanitizeCategory(raw.category) : DEFAULT_CATEGORY,
    servers: sanitizeServerLooks(raw.servers),
  }
}

function writeLocal(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* plein ou bloqué : le choix vaut pour la session */ }
}

/** Charge utile envoyée au compte (sans les images locales si elle est trop lourde). */
export function studioPayload(st: Studio) {
  if (JSON.stringify(st).length <= SYNC_BUDGET) return st
  return { ...st, customs: st.customs.map(c => (c.image?.url.startsWith('data:') ? { ...c, image: null } : c)) }
}

const studioOf = (s: Studio): Studio => ({ customs: s.customs, layout: s.layout, category: s.category, servers: s.servers })

let syncTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSync() {
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    api.put('/user/theme-studio', studioPayload(studioOf(useThemeStore.getState()))).catch(() => { /* hors ligne : réessayé au prochain changement */ })
  }, 800)
}

function persistStudio() {
  writeLocal(STUDIO_KEY, JSON.stringify(studioOf(useThemeStore.getState())))
}

/** Thème choisi pour le serveur affiché, s'il en a un (et qu'il existe encore). */
function serverThemeId(s: Pick<ThemeState, 'servers' | 'serverId' | 'customs'>): string | null {
  const id = s.serverId ? s.servers[s.serverId]?.theme : undefined
  return id && findTheme(id, s.customs) ? id : null
}

/** Thème réellement affiché : aperçu en cours, sinon celui du serveur affiché, sinon celui de ForgeChat. */
export function resolveTheme(s: Pick<ThemeState, 'activeId' | 'customs' | 'accent' | 'preview' | 'servers' | 'serverId'>): ThemeSpec {
  if (s.preview) return s.preview
  const id = serverThemeId(s) ?? s.activeId
  const custom = s.customs.find(c => c.id === id)
  if (custom) return custom
  return withAccent(findTheme(id) ?? DEFAULT_SPEC, s.accent)
}

function render() {
  const s = useThemeStore.getState()
  const id = serverThemeId(s) ?? s.activeId
  applyThemeToDom(findTheme(id, s.customs) ? id : DEFAULT_THEME_ID, resolveTheme(s))
  applyCategoryToDom((s.serverId && s.servers[s.serverId]?.category) || s.category)
}

const initial = readLocal()

export const useThemeStore = create<ThemeState>()((set, get) => ({
  ...initial,
  accent: null,
  preview: null,
  serverId: null,
  select: id => {
    set({ activeId: id, preview: null })
    writeLocal(THEME_KEY, id)
    render()
    api.put('/user/theme', { theme: id }).catch(() => { /* hors ligne : gardé localement */ })
  },
  upsertCustom: t => {
    const customs = get().customs.some(c => c.id === t.id)
      ? get().customs.map(c => (c.id === t.id ? t : c))
      : [...get().customs, t]
    set({ customs })
    persistStudio()
    scheduleSync()
    render()
  },
  removeCustom: id => {
    const customs = get().customs.filter(c => c.id !== id)
    set({ customs })
    persistStudio()
    scheduleSync()
    if (get().activeId === id) get().select(DEFAULT_THEME_ID)
    else render()
  },
  setLayout: patch => {
    const layout = sanitizeLayout({ ...get().layout, ...patch })
    set({ layout })
    persistStudio()
    applyLayoutToDom(layout)
    scheduleSync()
  },
  setAccent: accent => {
    set({ accent: isHex(accent) ? accent.toLowerCase() : null })
    render()
  },
  setPreview: spec => {
    set({ preview: spec })
    render()
  },
  setDensity: d => {
    set({ density: d })
    document.documentElement.setAttribute('data-density', d)
    writeLocal('fc_density', d)
  },
  setCategory: patch => {
    set({ category: sanitizeCategory({ ...get().category, ...patch }) })
    persistStudio()
    scheduleSync()
    render()
  },
  setServerLook: (serverId, look) => {
    const servers = { ...get().servers }
    const key = serverId.toLowerCase()
    if (look && (look.theme || look.category)) servers[key] = look
    else delete servers[key]
    set({ servers })
    persistStudio()
    scheduleSync()
    render()
  },
  setServerId: serverId => {
    const id = serverId?.toLowerCase() ?? null
    if (id === get().serverId) return
    set({ serverId: id })
    render()
  },
  loadRemote: async () => {
    const [theme, studio] = await Promise.allSettled([api.get('/user/theme'), api.get('/user/theme-studio')])
    if (studio.status === 'fulfilled') {
      const d = studio.value.data as Record<string, unknown> | null
      if (d && typeof d === 'object') {
        // Les images locales non synchronisées restent : on garde la version locale d'un thème si le compte l'a sans image.
        const local = new Map(get().customs.map(c => [c.id, c]))
        const customs = sanitizeCustomList(d.customs).map(c => {
          const kept = local.get(c.id)?.image
          return !c.image && kept ? { ...c, image: kept } : c
        })
        const remote = sanitizeStudio(d)
        set({ ...remote, customs })
        persistStudio()
        applyLayoutToDom(remote.layout)
      } else if (get().customs.length) {
        scheduleSync() // rien sur le compte : y envoyer les thèmes de cet appareil
      }
    }
    if (theme.status === 'fulfilled') {
      const t = (theme.value.data as { theme?: unknown } | null)?.theme
      if (typeof t === 'string' && t !== get().activeId && findTheme(t, get().customs)) {
        set({ activeId: t })
        writeLocal(THEME_KEY, t)
      }
    }
    render()
  },
}))

// Avant le premier rendu : pas de flash du thème par défaut.
document.documentElement.setAttribute('data-density', initial.density)
render()
applyLayoutToDom(initial.layout)
