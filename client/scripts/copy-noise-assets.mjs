// Copie les worklets + binaires wasm de @sapphi-red/web-noise-suppressor dans public/noise/.
// Lancé par `npm run prebuild` (et manuellement après une mise à jour du paquet).
// Les fichiers sont versionnés dans le dépôt pour qu'un build sans node_modules frais
// (image Docker, CI) serve quand même les moteurs de suppression de bruit.
import { mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, '..', 'node_modules', '@sapphi-red', 'web-noise-suppressor', 'dist')
const out = join(here, '..', 'public', 'noise')

const FILES = [
  ['rnnoise/workletProcessor.js', 'rnnoise-processor.js'],
  ['speex/workletProcessor.js', 'speex-processor.js'],
  ['noiseGate/workletProcessor.js', 'noise-gate-processor.js'],
  ['gtcrn/workletProcessor.js', 'gtcrn-processor.js'],
  ['rnnoise.wasm', 'rnnoise.wasm'],
  ['rnnoise_simd.wasm', 'rnnoise_simd.wasm'],
  ['speex.wasm', 'speex.wasm'],
  ['gtcrn.wasm', 'gtcrn.wasm'],
]

if (!existsSync(src)) {
  console.warn('[noise] paquet @sapphi-red/web-noise-suppressor absent — copie ignorée')
  process.exit(0)
}

mkdirSync(out, { recursive: true })
for (const [from, to] of FILES) {
  copyFileSync(join(src, from), join(out, to))
}
console.log(`[noise] ${FILES.length} fichiers copiés vers public/noise/`)
