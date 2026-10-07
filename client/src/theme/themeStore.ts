import { create } from 'zustand'
import api from '../api/client'
import {
  DEFAULT_SPEC, DEFAULT_THEME_ID, findTheme, isHex, sanitizeCustomList, withAccent,
  type CustomTheme, type ThemeSpec,
} from './themeCore'
import { applyLayoutToDom, applyThemeToDom, DEFAULT_LAYOUT, sanitizeLayout, type LayoutPrefs } from './applyTheme'

/**
 * Thème actif, thèmes perso et disposition. Stockés dans ce navigateur ET sur le compte
 * (/user/theme pour le thème actif, /user/theme-studio pour les thèmes perso et la disposition) :
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
  select: (id: string) => void
  upsertCustom: (t: CustomTheme) => void
  removeCustom: (id: string) => void
  setLayout: (patch: Partial<LayoutPrefs>) => void
  setAccent: (accent: string | null) => void
  setPreview: (spec: ThemeSpec | null) => void
  setDensity: (d: Density) => void
  loadRemote: () => Promise<void>
}

const THEME_KEY = 'fc_theme'
const STUDIO_KEY = 'fc_theme_studio'
/** Au-delà, les images locales (base64) ne partent pas sur le compte : elles restent sur cet appareil. */
const SYNC_BUDGET = 900_000

function readLocal(): { activeId: string; customs: CustomTheme[]; layout: LayoutPrefs; density: Density } {
  let raw: Record<string, unknown> = {}
  let activeId = DEFAULT_THEME_ID
  let density: Density = 'normal'
  try {
    activeId = localStorage.getItem(THEME_KEY) || DEFAULT_THEME_ID
    density = asDensity(localStorage.getItem('fc_density'))
    const parsed: unknown = JSON.parse(localStorage.getItem(STUDIO_KEY) ?? '{}')
    if (parsed && typeof parsed === 'object') raw = parsed as Record<string, unknown>
  } catch { /* stockage indisponible ou corrompu : valeurs par défaut */ }
  return { activeId, customs: sanitizeCustomList(raw.customs), layout: sanitizeLayout(raw.layout), density }
}

function writeLocal(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* plein ou bloqué : le choix vaut pour la session */ }
}

/** Charge utile envoyée au compte (sans les images locales si elle est trop lourde). */
export function studioPayload(customs: CustomTheme[], layout: LayoutPrefs) {
  const full = { customs, layout }
  if (JSON.stringify(full).length <= SYNC_BUDGET) return full
  return { customs: customs.map(c => (c.image?.url.startsWith('data:') ? { ...c, image: null } : c)), layout }
}

let syncTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSync() {
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    const { customs, layout } = useThemeStore.getState()
    api.put('/user/theme-studio', studioPayload(customs, layout)).catch(() => { /* hors ligne : réessayé au prochain changement */ })
  }, 800)
}

function persistStudio(customs: CustomTheme[], layout: LayoutPrefs) {
  writeLocal(STUDIO_KEY, JSON.stringify({ customs, layout }))
}

/** Thème réellement affiché. */
export function resolveTheme(s: Pick<ThemeState, 'activeId' | 'customs' | 'accent' | 'preview'>): ThemeSpec {
  if (s.preview) return s.preview
  const custom = s.customs.find(c => c.id === s.activeId)
  if (custom) return custom
  return withAccent(findTheme(s.activeId) ?? DEFAULT_SPEC, s.accent)
}

function render() {
  const s = useThemeStore.getState()
  const known = !!findTheme(s.activeId, s.customs)
  applyThemeToDom(known ? s.activeId : DEFAULT_THEME_ID, resolveTheme(s))
}

const initial = readLocal()

export const useThemeStore = create<ThemeState>()((set, get) => ({
  ...initial,
  accent: null,
  preview: null,
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
    persistStudio(customs, get().layout)
    scheduleSync()
    render()
  },
  removeCustom: id => {
    const customs = get().customs.filter(c => c.id !== id)
    set({ customs })
    persistStudio(customs, get().layout)
    scheduleSync()
    if (get().activeId === id) get().select(DEFAULT_THEME_ID)
    else render()
  },
  setLayout: patch => {
    const layout = sanitizeLayout({ ...get().layout, ...patch })
    set({ layout })
    persistStudio(get().customs, layout)
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
        const layout = sanitizeLayout(d.layout)
        set({ customs, layout })
        persistStudio(customs, layout)
        applyLayoutToDom(layout)
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
