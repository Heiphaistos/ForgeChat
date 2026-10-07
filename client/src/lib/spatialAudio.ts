// Voix spatiale (casque) : chaque participant est placé sur un arc devant soi, de gauche à
// droite dans l'ordre du salon. Réglage local `fc_spatial_audio` (« true »). Calcul pur, testé
// (scripts/spatialAudio.test.mjs) ; le mobile utilise la même règle.

export const SPATIAL_KEY = 'fc_spatial_audio'

export function spatialEnabled(): boolean {
  try { return localStorage.getItem(SPATIAL_KEY) === 'true' } catch { return false }
}

/**
 * Angle (radians, 0 = devant, négatif = à gauche) du participant `index` parmi `count`.
 * Écart de 25° entre voisins, arc borné à ±75° : deux personnes restent proches du centre,
 * une salle pleine s'étale sans jamais passer derrière soi.
 */
export function spatialAzimuth(index: number, count: number): number {
  if (count <= 1 || index < 0 || index >= count) return 0
  const max = Math.min(75, 12.5 * (count - 1))
  const deg = -max + (2 * max * index) / (count - 1)
  return (deg * Math.PI) / 180
}

/** Position (x, z) sur un cercle d'1 m autour de l'auditeur, qui regarde vers -z. */
export function spatialPosition(azimuth: number): { x: number; z: number } {
  return { x: Math.sin(azimuth), z: -Math.cos(azimuth) }
}
