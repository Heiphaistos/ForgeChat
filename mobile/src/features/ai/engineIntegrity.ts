// Intégrité de la page moteur d'IA (audit mobile 2026-10-17) : la WebView reçoit du texte et de l'audio
// E2E déchiffrés, son code ne doit donc jamais être celui qu'un serveur compromis choisit. La page et
// tout son jeu de scripts (dont le Worker, qui porte aussi les empreintes des modèles) sont comparés à
// des SHA-256 embarqués dans l'APK (engineHashes.ts) ; au moindre écart, rien n'est chargé.
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { logger } from '@/lib/logger'
import { ENGINE_HASHES } from './engineHashes'

export type Fetcher = (url: string) => Promise<Uint8Array>

const defaultFetch: Fetcher = async (url) => {
  const r = await fetch(url, { redirect: 'error', credentials: 'omit' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return new Uint8Array(await r.arrayBuffer())
}

const hex = (b: Uint8Array) => bytesToHex(sha256(b))
const sri = (h: string) => `sha256-${btoa(String.fromCharCode(...hexToBytes(h)))}`
const SCRIPT_URL = /\/assets\/[A-Za-z0-9._-]+\.js/g

/**
 * Page moteur vérifiée, prête pour `source={{ html, baseUrl: origin }}`, ou null (refusée).
 * Chaque script est vérifié ici, puis son empreinte est imposée au WebView par `integrity=` (SRI).
 */
export async function loadVerifiedEngine(origin: string, get: Fetcher = defaultFetch, expected = ENGINE_HASHES): Promise<string | null> {
  try {
    const page = await get(`${origin}/ai-engine.html`)
    if (hex(page) !== expected['/ai-engine.html']) throw new Error('page')
    const html = new TextDecoder().decode(page)
    const urls = [...new Set(html.match(SCRIPT_URL) ?? [])]
    if (!urls.length) throw new Error('aucun script')
    // Tout le jeu de scripts connu (Worker compris, chargé par le moteur lui-même) doit être conforme.
    for (const u of Object.keys(expected).filter((k) => k.startsWith('/assets/'))) {
      if (hex(await get(`${origin}${u}`)) !== expected[u]) throw new Error(u)
    }
    for (const u of urls) if (!expected[u]) throw new Error(`inconnu ${u}`)
    // Le Worker est lancé par la page elle-même : son empreinte y est posée, la page le relit avec
    // `integrity` et le démarre depuis cette copie (client/src/ai/engineCore.ts).
    const worker = Object.keys(expected).find((k) => /\/engine\.worker-[A-Za-z0-9_-]+\.js$/.test(k))
    if (!worker || !html.includes('</head>')) throw new Error('worker')
    return html.replace('</head>', `<meta name="fc-worker-integrity" content="${sri(expected[worker]!)}"></head>`).replace(/<(script|link)\b([^>]*?)(\/assets\/[A-Za-z0-9._-]+\.js)"/g, (_m, tag: string, pre: string, u: string) =>
      `<${tag}${pre}${u}" integrity="${sri(expected[u]!)}"`)
  } catch (e) {
    logger.warn('ai', 'page moteur refusée (empreinte différente ou injoignable)', e)
    return null
  }
}
