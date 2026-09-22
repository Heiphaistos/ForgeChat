// Fenêtres détachées : un stream, une caméra, chacun dans sa propre fenêtre,
// autant qu'on veut en même temps (Discord n'en détache qu'une, pour tout l'appel).
//
// La fenêtre est ouverte vide sur la même origine : elle partage donc les objets
// MediaStream de la fenêtre principale, sans nouvelle connexion au serveur média.
// Le son reste joué par la fenêtre principale (volumes, sortie audio choisie).
import { useVoice } from '../store/voice'
import { useAuth } from '../store/auth'

export type PopKind = 'camera' | 'screen'

interface Pop { win: Window; video: HTMLVideoElement; userId: string; kind: PopKind }

const _pops = new Map<string, Pop>()
let _unsub: (() => void) | null = null

const keyOf = (userId: string, kind: PopKind) => `${userId}:${kind}`

/** Flux courant d'une tuile, relu dans le store (les MediaStream sont recréés à chaque changement de piste). */
function currentStream(userId: string, kind: PopKind): MediaStream | null {
  const s = useVoice.getState()
  if (!s.joined) return null
  if (userId === useAuth.getState().user?.id) {
    return kind === 'screen' ? (s.screenSharing ? s.localScreenStream : null) : s.localStream
  }
  const p = s.peers.find(x => x.userId === userId)
  if (!p) return null
  return kind === 'screen' ? p.screenStream : p.stream
}

function sync() {
  for (const [key, pop] of _pops) {
    if (pop.win.closed) { _pops.delete(key); continue }
    const stream = currentStream(pop.userId, pop.kind)
    const hasVideo = !!stream?.getVideoTracks().some(t => t.readyState === 'live')
    if (!hasVideo) {
      // Fin du partage, caméra coupée ou départ du salon : la fenêtre n'a plus d'objet.
      pop.win.close()
      _pops.delete(key)
      continue
    }
    if (pop.video.srcObject !== stream) pop.video.srcObject = stream
  }
  if (_pops.size === 0 && _unsub) { _unsub(); _unsub = null }
}

function buildWindow(win: Window, title: string): HTMLVideoElement {
  const doc = win.document
  doc.title = title
  doc.body.replaceChildren()
  doc.body.style.cssText = 'margin:0;background:#000;height:100vh;overflow:hidden;display:flex;align-items:center;justify-content:center'
  const video = doc.createElement('video')
  video.autoplay = true
  video.playsInline = true
  // Le son de la personne est déjà joué par la fenêtre principale.
  video.muted = true
  video.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#000'
  video.title = 'Double-clic : plein écran'
  video.addEventListener('dblclick', () => {
    if (doc.fullscreenElement) void doc.exitFullscreen()
    else void video.requestFullscreen().catch(() => {})
  })
  doc.body.appendChild(video)
  return video
}

/** Ouvre (ou ramène au premier plan) la fenêtre détachée d'une tuile. `false` si le navigateur l'a bloquée. */
export function popOut(userId: string, kind: PopKind, label: string): boolean {
  const key = keyOf(userId, kind)
  const existing = _pops.get(key)
  if (existing && !existing.win.closed) { existing.win.focus(); return true }

  const stream = currentStream(userId, kind)
  if (!stream) return false
  const win = window.open('', `fc-pop-${key.replace(/[^a-zA-Z0-9-]/g, '_')}`, 'popup,width=1024,height=600')
  if (!win) return false

  const title = kind === 'screen' ? `Écran de ${label} — ForgeChat` : `${label} — ForgeChat`
  const video = buildWindow(win, title)
  video.srcObject = stream
  _pops.set(key, { win, video, userId, kind })
  _unsub ??= useVoice.subscribe(sync)
  win.addEventListener('pagehide', () => { _pops.delete(key) })
  return true
}

export function closeAllPopOuts() {
  for (const p of _pops.values()) p.win.close()
  _pops.clear()
  if (_unsub) { _unsub(); _unsub = null }
}
