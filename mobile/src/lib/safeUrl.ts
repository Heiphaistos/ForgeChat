// Lien masqué trompeur : même règle que client/src/utils/safeUrl.ts (garder identiques),
// testée par __tests__/safe-url.test.ts. Le filtrage des schémas est dans lib/links.ts.

const bare = (h: string) => h.toLowerCase().replace(/^www\./, '')

/**
 * Lien masqué [texte](cible) : si le texte ressemble à une adresse d'un AUTRE hôte que la
 * cible (« paypal.com » qui mène ailleurs), rend l'hôte réel à afficher ; sinon null.
 */
export function deceptiveHost(label: string, href: string): string | null {
  let real: string
  try { real = new URL(href).hostname } catch { return null }
  const m = label.match(/((?:[\p{L}\p{N}-]+\.)+\p{L}{2,})/u)
  if (!m) return null
  let shown: string
  try { shown = new URL(`http://${m[1]}`).hostname } catch { return real } // texte d'adresse invalide : on montre la cible
  const r = bare(real)
  const s = bare(shown)
  return r === s || r.endsWith(`.${s}`) ? null : real
}
