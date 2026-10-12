// Partage de position (audit 2026-10-12, amélioration n° 34). La position voyage dans le corps
// CHIFFRÉ du message (`g`), jamais en clair pour le serveur ; l'affichage ne charge aucune tuile
// de carte (ce qui révélerait la position à un tiers) : lien OpenStreetMap ouvert à la demande.
// Testé par scripts/geo.test.mjs.

export interface Geo { lat: number; lon: number; acc?: number }

/** Position lue d'un corps de message, validée (null si absente ou invalide). */
export function geoOf(body: unknown): Geo | null {
  const g = (body as { g?: unknown } | null)?.g as Partial<Geo> | undefined
  if (!g || typeof g.lat !== 'number' || typeof g.lon !== 'number') return null
  if (!Number.isFinite(g.lat) || !Number.isFinite(g.lon) || Math.abs(g.lat) > 90 || Math.abs(g.lon) > 180) return null
  const acc = typeof g.acc === 'number' && Number.isFinite(g.acc) && g.acc >= 0 ? Math.min(g.acc, 100_000) : undefined
  return { lat: g.lat, lon: g.lon, ...(acc !== undefined ? { acc } : {}) }
}

/** Arrondi à ~1 m (5 décimales) : pas de fausse précision. */
export const roundGeo = (g: Geo): Geo => ({ lat: Math.round(g.lat * 1e5) / 1e5, lon: Math.round(g.lon * 1e5) / 1e5, ...(g.acc !== undefined ? { acc: Math.round(g.acc) } : {}) })

export const osmUrl = (g: Geo) => `https://www.openstreetmap.org/?mlat=${g.lat}&mlon=${g.lon}#map=16/${g.lat}/${g.lon}`

/** Position actuelle de l'appareil (demande la permission). */
export function currentGeo(): Promise<Geo> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('unsupported'))
    navigator.geolocation.getCurrentPosition(
      p => resolve(roundGeo({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy })),
      e => reject(e),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    )
  })
}
