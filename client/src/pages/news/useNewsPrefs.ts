// Préférences de la page Actualités, propres à chaque compte et synchronisées entre appareils :
// le serveur fait foi (/users/me/news-prefs), le localStorage sert de cache pour l'affichage immédiat.
import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../../api/client'
import { key } from '../newsOrder'

export const THEMES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const
export type ThemeId = typeof THEMES[number]
export const DEFAULT_THEME: ThemeId = 6

export interface NewsPrefs {
  theme: ThemeId
  /** Épinglées (thème 6) : « c:<clé de rubrique> » ou « s:<id de site> », dans l'ordre choisi. */
  pins: string[]
  /** Ordre des rubriques (clés key()). */
  order: string[]
  /** Sites coupés : ni dans la navigation ni dans les articles. */
  muted: string[]
  /** Groupes (« g:<id> ») et rubriques repliés ou dépliés. */
  folded: Record<string, boolean>
}

const KEY = 'fc_news_prefs'
// Bornes : le tout reste sous les 16 Ko acceptés par le serveur.
const strs = (v: unknown, max: number) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length <= 120).slice(0, max) : []

export function sanitize(v: unknown): NewsPrefs {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const theme = THEMES.includes(o.theme as ThemeId) ? o.theme as ThemeId : DEFAULT_THEME
  const folded: Record<string, boolean> = {}
  if (o.folded && typeof o.folded === 'object') {
    for (const [k, b] of Object.entries(o.folded as Record<string, unknown>).slice(0, 80)) if (typeof b === 'boolean' && k.length <= 120) folded[k] = b
  }
  return { theme, pins: strs(o.pins, 60), order: strs(o.order, 80), muted: strs(o.muted, 200), folded }
}

const read = (k: string): unknown => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null } catch { return null } }
const write = (p: NewsPrefs) => { try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* cache seulement */ } }

/** Cache local, ou (une seule fois) les anciens réglages de cet appareil : fc_news_order / fc_news_folded. */
function initial(): NewsPrefs {
  const cached = read(KEY)
  if (cached) return sanitize(cached)
  // Anciens repliés : indexés par nom brut de rubrique, désormais par sa clé key().
  const old = read('fc_news_folded')
  const folded = old && typeof old === 'object' ? Object.fromEntries(Object.entries(old).map(([c, b]) => [key(c), b])) : {}
  const p = sanitize({ order: read('fc_news_order'), folded })
  write(p)
  try { localStorage.removeItem('fc_news_order'); localStorage.removeItem('fc_news_folded') } catch { /* rien à migrer */ }
  return p
}

export function useNewsPrefs() {
  const [prefs, setPrefs] = useState<NewsPrefs>(initial)
  const loaded = useRef(false)
  const sent = useRef('')
  const cur = useRef(prefs)

  useEffect(() => {
    let alive = true
    api.get('/users/me/news-prefs').then(({ data }) => {
      if (!alive) return
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        const p = sanitize(data)
        sent.current = JSON.stringify(p)
        setPrefs(p)
      } else {
        // Rien en ligne : les réglages de cet appareil deviennent la référence.
        sent.current = JSON.stringify(cur.current)
        api.put('/users/me/news-prefs', cur.current).catch(() => {})
      }
      loaded.current = true
    }).catch(() => { /* hors ligne : cache local, sans écraser le serveur */ })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    write(prefs)
    cur.current = prefs
    if (!loaded.current) return
    const json = JSON.stringify(prefs)
    if (json === sent.current) return
    const h = setTimeout(() => { sent.current = json; api.put('/users/me/news-prefs', prefs).catch(() => {}) }, 800)
    return () => clearTimeout(h)
  }, [prefs])

  // En quittant la page avant la fin de l'anti-rebond : envoi immédiat du dernier changement.
  useEffect(() => () => {
    if (loaded.current && JSON.stringify(cur.current) !== sent.current) api.put('/users/me/news-prefs', cur.current).catch(() => {})
  }, [])

  const update = useCallback((patch: Partial<NewsPrefs>) => setPrefs(p => sanitize({ ...p, ...patch })), [])
  return [prefs, update] as const
}
