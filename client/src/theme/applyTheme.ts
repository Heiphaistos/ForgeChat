import { COLOR_KEYS, cssGradient, isTranslucent, rgbOf, type Pattern, type ThemeSpec } from './themeCore.ts'

/**
 * Mise en page de l'application (web et bureau), synchronisée avec le compte (/user/theme-studio).
 * Chaque réglage devient un attribut data-fc-* (identifiant de liste) ou une variable CSS (nombre
 * borné) sur <html>, lus par index.css : jamais de texte libre dans le CSS.
 */
export interface LayoutPrefs {
  /** Côté de la liste des membres. */
  members: 'right' | 'left'
  /** Largeur de la liste des membres (px). */
  membersWidth: number
  /** Liste des membres : affichée (selon le bouton de l'en-tête) ou toujours masquée sur grand écran. */
  membersVisible: 'auto' | 'hidden'
  /** Rail des serveurs : toujours visible, ou replié et révélé au survol de la barre latérale. */
  rail: 'show' | 'hover'
  /** Taille du rail des serveurs : normale ou compacte (icônes réduites). */
  railSize: 'normal' | 'compact'
  /** Côté de la barre latérale (rail + salons) sur grand écran. */
  sidebarSide: 'left' | 'right'
  /** Rail des serveurs au bord de la fenêtre (extérieur) ou contre la discussion (intérieur). */
  railSide: 'outer' | 'inner'
  /** Densité de la liste des salons. */
  channelDensity: 'compact' | 'normal' | 'cozy'
  /** Barre de saisie : en retrait (défaut), flottante, collée en bas, en pilule ou minimale. */
  composer: 'inset' | 'floating' | 'attached' | 'pill' | 'minimal'
  /** Style des messages : à plat (défaut), cartes, ou bulles autour du texte. */
  bubbles: 'flat' | 'cards' | 'bubbles'
  /** Affichage des messages : confortable (avatar + nom au-dessus) ou IRC (nom et texte sur une ligne). */
  chatMode: 'cozy' | 'irc'
  /** Largeur de la discussion : toute la place, ou colonne centrée plus lisible. */
  chatWidth: 'full' | 'centered'
  /** Largeur maximale de la colonne centrée (px). */
  contentWidth: number
  /** Espace ajouté avant chaque nouveau groupe de messages (px). */
  messageGap: number
  /** Taille du texte des messages (% de la taille normale). */
  chatFontScale: number
  /** Interligne des messages (centièmes : 163 = 1,63). */
  lineHeight: number
  /** Taille des avatars dans la discussion. */
  avatarSize: 'small' | 'normal' | 'large'
  /** Position de l'heure dans l'en-tête d'un message : après le nom, avant, ou alignée à droite. */
  timestampPos: 'after' | 'before' | 'right'
  /** Taille des emojis personnalisés dans les messages. */
  emojiSize: 'small' | 'normal' | 'large' | 'huge'
  /** Taille des aperçus d'images envoyées. */
  imageSize: 'small' | 'medium' | 'large'
  /** Arrondis de l'interface : ceux du thème, carrés, doux ou très ronds. */
  corners: 'theme' | 'sharp' | 'soft' | 'round'
  /** En-tête des salons : normal, transparent, liseré d'accent, compact ou flottant. */
  header: 'default' | 'transparent' | 'accent' | 'compact' | 'floating'
  /** Panneaux opaques : supprime la transparence et le flou des thèmes translucides. */
  reduceTransparency: boolean
  /** Intensité du verre dépoli (% du flou du thème). */
  glass: number
  /** Barres de défilement : normales, fines ou masquées (le défilement reste possible). */
  scrollbars: 'normal' | 'thin' | 'hidden'
}

export const DEFAULT_LAYOUT: LayoutPrefs = {
  members: 'right', membersWidth: 240, membersVisible: 'auto', rail: 'show', railSize: 'normal', sidebarSide: 'left',
  railSide: 'outer', channelDensity: 'normal', composer: 'inset', bubbles: 'flat', chatMode: 'cozy', chatWidth: 'full',
  contentWidth: 980, messageGap: 0, chatFontScale: 100, lineHeight: 163, avatarSize: 'normal', timestampPos: 'after',
  emojiSize: 'normal', imageSize: 'medium', corners: 'theme', header: 'default', reduceTransparency: false, glass: 100,
  scrollbars: 'normal',
}

/** Bornes des réglages numériques : [min, max]. */
export const LAYOUT_RANGES = {
  membersWidth: [200, 360],
  contentWidth: [600, 1600],
  messageGap: [0, 32],
  chatFontScale: [80, 150],
  lineHeight: [120, 220],
  glass: [0, 200],
} as const satisfies Partial<Record<keyof LayoutPrefs, readonly [number, number]>>

/** Choix possibles des réglages à liste (le premier n'est pas forcément le défaut : voir DEFAULT_LAYOUT). */
export const LAYOUT_CHOICES = {
  members: ['right', 'left'],
  membersVisible: ['auto', 'hidden'],
  rail: ['show', 'hover'],
  railSize: ['normal', 'compact'],
  sidebarSide: ['left', 'right'],
  railSide: ['outer', 'inner'],
  channelDensity: ['compact', 'normal', 'cozy'],
  composer: ['inset', 'floating', 'attached', 'pill', 'minimal'],
  bubbles: ['flat', 'cards', 'bubbles'],
  chatMode: ['cozy', 'irc'],
  chatWidth: ['full', 'centered'],
  avatarSize: ['small', 'normal', 'large'],
  timestampPos: ['after', 'before', 'right'],
  emojiSize: ['small', 'normal', 'large', 'huge'],
  imageSize: ['small', 'medium', 'large'],
  corners: ['theme', 'sharp', 'soft', 'round'],
  header: ['default', 'transparent', 'accent', 'compact', 'floating'],
  scrollbars: ['normal', 'thin', 'hidden'],
} as const satisfies { [K in keyof LayoutPrefs]?: readonly LayoutPrefs[K][] }

const oneOf = <T extends string>(v: unknown, values: readonly T[], def: T): T => (values.includes(v as T) ? (v as T) : def)
export const MEMBERS_MIN = LAYOUT_RANGES.membersWidth[0]
export const MEMBERS_MAX = LAYOUT_RANGES.membersWidth[1]

const clampInt = (v: unknown, [min, max]: readonly [number, number], def: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def

export function sanitizeLayout(raw: unknown): LayoutPrefs {
  const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out = { ...DEFAULT_LAYOUT } as Record<string, unknown>
  for (const [k, values] of Object.entries(LAYOUT_CHOICES)) {
    out[k] = oneOf(v[k], values as readonly string[], DEFAULT_LAYOUT[k as keyof LayoutPrefs] as string)
  }
  for (const [k, range] of Object.entries(LAYOUT_RANGES)) {
    out[k] = clampInt(v[k], range, DEFAULT_LAYOUT[k as keyof LayoutPrefs] as number)
  }
  out.reduceTransparency = v.reduceTransparency === true
  return out as unknown as LayoutPrefs
}

const triplet = (hex: string) => rgbOf(hex).join(' ')

/** Variables CSS du thème (lues par Tailwind : bg-fc-*, text-fc-*…). Valeurs numériques uniquement. */
export function themeVars(s: ThemeSpec): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const k of COLOR_KEYS) vars[`--fc-${k}-rgb`] = triplet(s.colors[k])
  // « text-white » des composants : blanc en sombre, couleur du texte en clair.
  vars['--fc-strong-rgb'] = s.scheme === 'dark' ? '255 255 255' : triplet(s.colors.text)
  const translucent = isTranslucent(s)
  vars['--fc-surface-a'] = String(translucent ? s.opacity : 1)
  vars['--fc-float-a'] = String(translucent ? Math.max(0.88, s.opacity) : 1)
  vars['--fc-glass-blur'] = `${s.blur}px`
  vars['--fc-radius'] = String(s.radius)
  vars['--fc-accent2-rgb'] = triplet(s.accent2 ?? s.colors.accent)
  return vars
}

/**
 * Motif du fond en CSS, construit uniquement à partir de nombres (couleur du texte, opacité bornée) :
 * jamais de chaîne venant du thème.
 */
export function patternCss(p: Pattern, rgb: string, alpha: number): string | null {
  const c = `rgb(${rgb} / ${Math.min(0.4, Math.max(0, alpha))})`
  switch (p) {
    case 'dots': return `radial-gradient(${c} 1px, transparent 1.6px) 0 0 / 16px 16px`
    case 'grid': return `linear-gradient(${c} 1px, transparent 1px) 0 0 / 24px 24px, linear-gradient(90deg, ${c} 1px, transparent 1px) 0 0 / 24px 24px`
    case 'lines': return `repeating-linear-gradient(0deg, ${c} 0 1px, transparent 1px 4px)`
    case 'diagonal': return `repeating-linear-gradient(45deg, ${c} 0 1px, transparent 1px 14px)`
    case 'checker': return `conic-gradient(${c} 25%, transparent 0 50%, ${c} 0 75%, transparent 0) 0 0 / 32px 32px`
    case 'waves': return `radial-gradient(circle at 50% 100%, transparent 8px, ${c} 9px 10px, transparent 11px) 0 0 / 24px 12px`
    default: return null
  }
}

/** Calque de fond (dégradé et/ou image) derrière toute l'application. */
function applyBackdrop(s: ThemeSpec) {
  let el = document.getElementById('fc-backdrop')
  if (!s.gradient && !s.image) {
    el?.remove()
    return
  }
  if (!el) {
    el = document.createElement('div')
    el.id = 'fc-backdrop'
    el.setAttribute('aria-hidden', 'true')
    document.body.prepend(el)
  }
  const layers: string[] = []
  if (s.image) {
    const veil = s.scheme === 'dark' ? `rgba(0, 0, 0, ${s.image.dim})` : `rgba(255, 255, 255, ${s.image.dim})`
    // URL déjà validée (https sans guillemets/parenthèses, ou data:image base64).
    layers.push(`linear-gradient(${veil}, ${veil})`, `url("${s.image.url}")`)
  }
  if (s.gradient) layers.push(cssGradient(s.gradient))
  el.style.backgroundImage = layers.join(', ')
  el.style.backgroundColor = s.colors.bg
  el.style.filter = s.image && s.image.blur > 0 ? `blur(${s.image.blur}px)` : ''
}

export function applyThemeToDom(id: string, s: ThemeSpec) {
  const root = document.documentElement
  for (const [k, v] of Object.entries(themeVars(s))) root.style.setProperty(k, v)
  root.setAttribute('data-theme', id)
  root.setAttribute('data-fc-scheme', s.scheme)
  root.style.colorScheme = s.scheme
  root.toggleAttribute('data-fc-outline', s.outline)
  root.toggleAttribute('data-fc-glass', isTranslucent(s) && s.blur > 0)
  root.toggleAttribute('data-fc-accent-grad', !!s.accent2)
  // Motif : sur le calque de fond s'il est visible (thème translucide), sinon sur la zone de discussion.
  const pattern = patternCss(s.pattern, triplet(s.colors.text), s.patternOpacity)
  if (pattern) {
    root.style.setProperty('--fc-pattern', pattern)
    root.setAttribute('data-fc-pattern', isTranslucent(s) ? 'backdrop' : 'surface')
  } else {
    root.style.removeProperty('--fc-pattern')
    root.removeAttribute('data-fc-pattern')
  }
  applyBackdrop(s)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', s.colors.sidebar)
}

export function applyLayoutToDom(l: LayoutPrefs) {
  const root = document.documentElement
  const attr: Record<string, string> = {
    'data-fc-members': l.members,
    'data-fc-members-vis': l.membersVisible,
    'data-fc-rail': l.rail,
    'data-fc-rail-size': l.railSize,
    'data-fc-sidebar-side': l.sidebarSide,
    'data-fc-rail-side': l.railSide,
    'data-fc-ch-density': l.channelDensity,
    'data-fc-composer': l.composer,
    'data-fc-bubbles': l.bubbles,
    'data-fc-chat-mode': l.chatMode,
    'data-fc-chat-width': l.chatWidth,
    'data-fc-avatar-size': l.avatarSize,
    'data-fc-ts-pos': l.timestampPos,
    'data-fc-emoji': l.emojiSize,
    'data-fc-img': l.imageSize,
    'data-fc-corners': l.corners,
    'data-fc-header': l.header,
    'data-fc-scrollbars': l.scrollbars,
  }
  for (const [k, v] of Object.entries(attr)) root.setAttribute(k, v)
  root.toggleAttribute('data-fc-solid', l.reduceTransparency)
  // Nombres déjà bornés par sanitizeLayout.
  root.style.setProperty('--fc-members-w', `${l.membersWidth}px`)
  root.style.setProperty('--fc-chat-max', `${l.contentWidth}px`)
  root.style.setProperty('--fc-msg-gap', `${l.messageGap}px`)
  root.style.setProperty('--fc-chat-scale', String(l.chatFontScale / 100))
  root.style.setProperty('--fc-chat-lh', String(l.lineHeight / 100))
  root.style.setProperty('--fc-glass-k', String(l.glass / 100))
}
