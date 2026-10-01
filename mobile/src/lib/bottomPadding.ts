/**
 * Marge du bas d'une barre collée en bas d'écran (zone de saisie…), en affichage bord à bord.
 *
 * Clavier fermé : au-dessus de la barre de navigation Android (3 boutons ou gestes) → `inset`.
 * Clavier ouvert : la hauteur du clavier (gérée par KeyboardAvoidingView) inclut déjà cette barre
 * → plus de marge. Entre les deux, on suit l'animation du clavier pour éviter un saut.
 */
export function bottomPadding(inset: number, keyboardProgress: number, base = 0): number {
  'worklet'
  const p = Math.min(Math.max(keyboardProgress, 0), 1)
  return base + inset * (1 - p)
}
