// Régénère src/features/ai/engineHashes.ts à partir d'un build web (client/dist) :
//   node scripts/ai-engine-hashes.mjs ../client/dist
// À relancer à chaque release web qui change la page moteur ou ses scripts (les noms Vite portent
// un hash) ; sans cela l'appli refuse le moteur d'IA (échec fermé) tant que l'APK n'est pas mis à jour.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dist = process.argv[2]
if (!dist) throw new Error('usage: node scripts/ai-engine-hashes.mjs <client/dist>')
const sha = (b) => createHash('sha256').update(b).digest('hex')
const files = {}
const page = readFileSync(join(dist, 'ai-engine.html'))
files['/ai-engine.html'] = sha(page)
// Fermeture des scripts : page -> modules -> Worker (noms de fichiers cités dans le code).
const queue = [...page.toString('utf8').matchAll(/\/assets\/[A-Za-z0-9._-]+\.js/g)].map((m) => m[0])
while (queue.length) {
  const p = queue.pop()
  if (files[p]) continue
  const body = readFileSync(join(dist, p))
  files[p] = sha(body)
  for (const m of body.toString('utf8').matchAll(/[A-Za-z0-9._-]+-[A-Za-z0-9_-]{8}\.js/g)) queue.push(`/assets/${m[0]}`)
}
const lines = Object.entries(files).sort().map(([k, v]) => `  '${k}': '${v}',`)
writeFileSync(new URL('../src/features/ai/engineHashes.ts', import.meta.url), `// GÉNÉRÉ par scripts/ai-engine-hashes.mjs : SHA-256 de la page moteur d'IA et de ses scripts.\nexport const ENGINE_HASHES: Readonly<Record<string, string>> = {\n${lines.join('\n')}\n}\n`)
console.log(Object.keys(files).length, 'fichiers')
