import { useEffect, useState } from 'react'
import { intlLocale, t } from '../../i18n'

/**
 * Versions publiées, lues dans les manifestes de mise à jour (une seule source de vérité : ce que
 * les applications installées voient). Écrits sur le VPS par deploy/forgechat_releases_sync.py.
 *   bureau : GET /api/desktop/latest (URL absolues)   mobile : /desktop/mobile.json
 */
export type Artefact = { url: string; size?: number; sha256?: string }
export type Release = { version: string; notes?: string; pub_date?: string; platforms: Record<string, Artefact> }

export const DL_BASE = 'https://forgechat.heiphaistos.org/desktop'
export const ALTSTORE_SOURCE = `${DL_BASE}/altstore.json`

function useManifest(url: string): Release | null {
  const [release, setRelease] = useState<Release | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch(url, { cache: 'no-cache' })
      .then(r => (r.ok && r.status !== 204 ? r.json() : null))
      .then((d: Release | null) => {
        if (!cancelled && d?.version && d.platforms) setRelease(d)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [url])
  return release
}

export const useDesktopRelease = () => useManifest('/api/desktop/latest')
export const useMobileRelease = () => useManifest('/desktop/mobile.json')

/** URL absolue d'un artefact (le manifeste mobile en donne déjà, le bureau aussi via l'API). */
export const artefactUrl = (a: Artefact) => (/^https:\/\//.test(a.url) ? a.url : `${DL_BASE}/${a.url}`)

export const taille = (a?: Artefact) => (a?.size ? t('site.dl.mb', { n: Math.round(a.size / 1_048_576) }) : '')

/** « 22 septembre 2026 » (ou « September 22, 2026 »), heure de Paris ; null si la date est absente ou illisible. */
export function dateLongue(iso?: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(intlLocale(), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' })
}

export type Plateforme = 'windows' | 'macos' | 'linux' | 'android' | 'iphone' | 'web'

/** Plateforme du visiteur, pour mettre son téléchargement en avant. */
export function plateformeDuVisiteur(): Plateforme {
  const ua = navigator.userAgent
  if (/android/i.test(ua)) return 'android'
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'iphone'
  if (/windows/i.test(ua)) return 'windows'
  if (/macintosh|mac os x/i.test(ua)) return 'macos'
  if (/linux|x11/i.test(ua)) return 'linux'
  return 'web'
}
