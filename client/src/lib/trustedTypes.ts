// Trusted Types (audit 2026-10-12, durcissement web). La CSP de production exige
// `require-trusted-types-for 'script'` : le navigateur refuse toute écriture de HTML ou d'adresse
// de script dans le DOM (innerHTML, script.src, new Worker…) qui ne passe pas par cette politique
// `default`. Même si une XSS trouvait un point d'entrée, elle ne pourrait ni injecter de balises,
// ni charger un script d'ailleurs.
//
// Ce qui est permis, et rien d'autre (relevé dans le bundle, 2026-10-12) :
// - HTML sans balise (style vide de react-hot-toast / goober) ;
// - coloration de code de highlight.js : texte échappé et <span class="hljs-…"> seulement ;
// - scripts et workers de NOTRE origine (assets Vite, MediaPipe, LiveKit E2EE), `blob:` de notre
//   origine, et l'API IFrame de YouTube (Regarder ensemble).
// Testé par `node --test scripts/trustedTypes.test.mjs`.

const HLJS_TAG = /<\/span>|<span class="(?:hljs-[a-z0-9_-]+|language-[a-z0-9_-]+)(?: [a-z0-9_-]+)*">/g

/** HTML admis : aucune balise, ou seulement les <span> de coloration de highlight.js. */
export function safeHtml(html: string): boolean {
  if (!html.includes('<')) return true
  return !html.replace(HLJS_TAG, '').includes('<')
}

const YOUTUBE_API = 'https://www.youtube.com/iframe_api'

/** Adresse de script admise : notre origine, `blob:` de notre origine, ou l'API YouTube. */
export function safeScriptUrl(url: string, origin: string): boolean {
  if (url === YOUTUBE_API) return true
  let u: URL
  try {
    u = new URL(url, origin)
  } catch {
    return false
  }
  if (u.protocol === 'blob:') return u.href.startsWith(`blob:${origin}/`)
  // Appli de bureau sous macOS/Linux : `tauri://localhost`, schéma non standard dont
  // `URL.origin` vaut "null" ; on compare alors le début de l'adresse (origine + « / »).
  if (u.origin === 'null') return origin !== 'null' && u.href.startsWith(`${origin}/`)
  return u.origin === origin
}

interface TrustedTypePolicyFactory {
  createPolicy(name: string, rules: {
    createHTML?: (s: string) => string | null
    createScript?: (s: string) => string | null
    createScriptURL?: (s: string) => string | null
  }): unknown
}

/** Installe la politique `default` (sans effet hors navigateur ou sans Trusted Types). */
export function installTrustedTypes() {
  const tt = (globalThis as { trustedTypes?: TrustedTypePolicyFactory }).trustedTypes
  if (!tt || typeof location === 'undefined') return
  const refuse = (kind: string, value: string) => {
    console.error(`Trusted Types : ${kind} refusé`, value.slice(0, 200))
    return null
  }
  try {
    tt.createPolicy('default', {
      createHTML: s => (safeHtml(s) ? s : refuse('HTML', s)),
      // Aucun code JavaScript sous forme de texte (eval, setTimeout("…"), script inline).
      createScript: s => refuse('script', s),
      createScriptURL: s => (safeScriptUrl(s, location.origin) ? s : refuse('adresse de script', s)),
    })
  } catch {
    // Déjà installée (rechargement à chaud en développement).
  }
}

installTrustedTypes()
