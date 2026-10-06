import { Alert } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import { apiHost, apiOrigin } from '@/config/env'
import { useSettings } from '@/stores/settings'

/**
 * Gestion sûre des URL :
 * - seules http(s) sont ouvrables (pas de javascript:, file:, intent:, tel: arbitraires…)
 * - les liens externes s'ouvrent dans un navigateur in-app isolé (pas de WebView
 *   partageant l'état de l'app), après confirmation affichant le domaine réel.
 */

export function parseSafeUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim())
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    if (u.username || u.password) return null // https://paypal.com@evil.tld
    return u
  } catch {
    return null
  }
}

/** Résout une URL de média renvoyée par le serveur (souvent relative : /uploads/…). */
export function resolveMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null
  if (url.startsWith('/uploads/') && !url.includes('..')) return apiOrigin() + url
  const u = parseSafeUrl(url)
  if (!u) return null
  // En production, on n'affiche que du HTTPS.
  if (u.protocol !== 'https:' && !__DEV__) return null
  return u.toString()
}

export function isOwnHost(u: URL) {
  return u.host === apiHost()
}

export async function openExternalUrl(raw: string): Promise<void> {
  const u = parseSafeUrl(raw)
  if (!u) {
    Alert.alert('Lien bloqué', 'Ce lien utilise un protocole non autorisé.')
    return
  }
  const open = () =>
    WebBrowser.openBrowserAsync(u.toString(), {
      showTitle: true,
      enableBarCollapsing: true,
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
    }).catch(() => undefined)

  if (isOwnHost(u) || !useSettings.getState().confirmLinks) {
    await open()
    return
  }
  Alert.alert(
    'Ouvrir un lien externe ?',
    `Tu vas quitter ForgeChat vers :\n\n${u.host}\n\n${u.toString().slice(0, 200)}`,
    [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Ouvrir', onPress: () => void open() },
    ],
  )
}
