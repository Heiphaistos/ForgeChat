/**
 * Disposition des vidéos d'appel (appels privés, appels de groupe, salons vocaux) — logique pure,
 * testée (__tests__/video-layout.test.ts) : vue grille ou focus façon Discord, épingle, vidéo
 * principale (image dans l'image), vignette accrochée aux coins, commandes masquées après un délai.
 */

/** Tuile d'appel : caméra (ou avatar) d'un participant, ou écran qu'il partage. */
export interface TileInfo {
  key: string
  userId: string
  self: boolean
  screen: boolean
  hasVideo: boolean
}

/** Tuile en grand (vue focus) : l'épinglée si elle est encore là, sinon aucune (vue grille). */
export function focusedTile<T extends TileInfo>(tiles: T[], pinned: string | null): T | null {
  return (pinned ? tiles.find((t) => t.key === pinned) : undefined) ?? null
}

/** Épingler une tuile ; la ré-épingler la libère (retour à la grille). */
export const togglePin = (pinned: string | null, key: string): string | null => (pinned === key ? null : key)

/**
 * Vidéo principale (image dans l'image, ratio de la fenêtre) : l'épinglée si elle a une vidéo,
 * sinon un écran partagé, sinon la caméra de qui parle, sinon la première caméra distante,
 * sinon la nôtre ; null sans aucune vidéo (appel audio : pas d'image dans l'image).
 */
export function mainVideoTile<T extends TileInfo>(tiles: T[], pinned: string | null, speaking: readonly string[]): T | null {
  const video = tiles.filter((t) => t.hasVideo)
  const remote = video.filter((t) => !t.self)
  return (
    video.find((t) => t.key === pinned) ??
    remote.find((t) => t.screen) ??
    remote.find((t) => speaking.includes(t.userId)) ??
    remote[0] ??
    video[0] ??
    null
  )
}

/** Au-delà, la grille défile (les cellules resteraient trop petites). */
export const GRID_MAX_VISIBLE = 12
const GRID_MAX_COLS = 4

/**
 * Grille qui remplit la zone W×H : le nombre de colonnes qui donne les plus grandes cellules
 * (côté le plus court). Une personne : tout l'écran ; deux : l'une sur l'autre en portrait, côte à
 * côte en paysage ; quatre : 2×2. Au-delà de GRID_MAX_VISIBLE tuiles, les rangées suivantes défilent.
 */
export function gridShape(n: number, W: number, H: number, gap = 8): { cols: number; cellW: number; cellH: number } {
  if (n <= 0 || W <= 0 || H <= 0) return { cols: 1, cellW: 0, cellH: 0 }
  const visible = Math.min(n, GRID_MAX_VISIBLE)
  let best = { cols: 1, cellW: 0, cellH: 0 }
  let bestScore = -1
  for (let cols = 1; cols <= Math.min(visible, GRID_MAX_COLS); cols++) {
    const rows = Math.ceil(visible / cols)
    const cellW = (W - gap * (cols - 1)) / cols
    const cellH = (H - gap * (rows - 1)) / rows
    const score = Math.min(cellW, cellH)
    if (score > bestScore) {
      bestScore = score
      best = { cols, cellW: Math.floor(cellW), cellH: Math.floor(cellH) }
    }
  }
  return best
}

/**
 * Coin le plus proche pour une vignette w×h lâchée en (x, y) dans un cadre W×H (marges comprises) :
 * position finale de son coin haut gauche.
 */
export function snapToCorner(
  x: number,
  y: number,
  w: number,
  h: number,
  frame: { W: number; H: number; top: number; bottom: number; side: number },
): { x: number; y: number } {
  'worklet'
  const left = frame.side
  const right = frame.W - frame.side - w
  const top = frame.top
  const bottom = frame.H - frame.bottom - h
  return {
    x: x + w / 2 < frame.W / 2 ? left : right,
    y: y + h / 2 < frame.H / 2 ? top : bottom,
  }
}

/** Délai avant de masquer les commandes d'un appel vidéo sans interaction. */
export const CONTROLS_HIDE_MS = 4000

export interface AutoHide {
  /** Interaction (appui sur un bouton…) : affiche et relance le délai. */
  poke(): void
  /** Appui sur la vidéo : masque ou réaffiche. */
  toggle(): void
  /** Masquage actif seulement quand il y a une vidéo à regarder ; sinon toujours visibles. */
  setEnabled(on: boolean): void
  dispose(): void
  readonly visible: boolean
}

/** Commandes qui se masquent après `delayMs` sans interaction et réapparaissent au toucher. */
export function createAutoHide(delayMs: number, onChange: (visible: boolean) => void): AutoHide {
  let visible = true
  let enabled = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const clear = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }
  const arm = () => {
    clear()
    if (enabled && visible) timer = setTimeout(() => show(false), delayMs)
  }
  const show = (v: boolean) => {
    if (v !== visible) {
      visible = v
      onChange(v)
    }
    arm()
  }
  return {
    poke: () => show(true),
    toggle: () => show(!visible || !enabled),
    setEnabled: (on) => {
      if (on === enabled) return
      enabled = on
      show(true)
    },
    dispose: clear,
    get visible() {
      return visible
    },
  }
}
