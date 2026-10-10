// Logiciel de diffusion (OBS, Streamlabs, XSplit…) en cours sur cet ordinateur ? App de bureau
// seulement (commande Tauri `streaming_software_running`) ; false sur le web, sur une app
// ancienne sans la commande, ou en cas d'erreur.
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export async function isStreamingSoftwareRunning(): Promise<boolean> {
  if (!isTauri) return false
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return (await invoke<boolean>('streaming_software_running')) === true
  } catch {
    return false
  }
}
