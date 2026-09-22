// Moteurs sans WebRTC : la WebKitGTK des distributions Linux est compilée sans
// (mesuré le 2026-09-22 : `typeof RTCPeerConnection === 'undefined'` dans
// WebKitGTK 2.50.4 d'Ubuntu, même avec enable-webrtc). L'application Linux ne
// peut donc passer aucun appel dans sa vue web : on ouvre la même page dans le
// navigateur du système, où le vocal fonctionne.

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export const webrtcMissing = () => typeof RTCPeerConnection === 'undefined'

/** Ouvre `path` (ex. `/servers/…/channels/…`) de l'instance ForgeChat dans le navigateur. */
export async function openInBrowser(path: string): Promise<boolean> {
  const url = `https://forgechat.heiphaistos.org${path.startsWith('/') ? path : `/${path}`}`
  if (!isTauri) return false
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('plugin:shell|open', { path: url })
    return true
  } catch (e) {
    console.warn('[voice] ouverture dans le navigateur impossible', e)
    return false
  }
}

export const NO_WEBRTC_MESSAGE =
  "Les appels ne sont pas possibles dans l'application Linux (son moteur d'affichage n'intègre pas WebRTC). " +
  'La page a été ouverte dans votre navigateur : le vocal y fonctionne normalement.'
