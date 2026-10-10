// Réglage Système « Accepter les fichiers glissés dans la fenêtre » (bureau).
// Le glisser-déposer HTML5 des pièces jointes marche dans la WebView parce que
// `dragDropEnabled` vaut false dans tauri.conf.json (sinon Tauri intercepte le
// dépôt et la page ne reçoit aucun fichier). Réglage coupé : on arrête les
// événements de fichiers dès la phase de capture, avant les zones de dépôt.
const KEY = 'fc_drag_drop'

export function dragDropEnabled(): boolean {
  try { return localStorage.getItem(KEY) !== '0' } catch { return true }
}

export function setDragDropEnabled(on: boolean) {
  try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* sans mémoire : réglage perdu au redémarrage */ }
}

export function installDragDropGuard() {
  const guard = (e: DragEvent) => {
    if (dragDropEnabled() || !e.dataTransfer?.types.includes('Files')) return
    e.stopPropagation()
    // Sans preventDefault au dépôt, la WebView ouvrirait le fichier à la place de l'appli.
    e.preventDefault()
    e.dataTransfer.dropEffect = 'none'
  }
  for (const type of ['dragenter', 'dragover', 'drop'] as const) window.addEventListener(type, guard, true)
}
