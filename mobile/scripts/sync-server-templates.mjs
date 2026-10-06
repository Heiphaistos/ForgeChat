#!/usr/bin/env node
// Modèles de serveur intégrés : copie EXACTE de ceux du client web (BUILTIN_TEMPLATES dans
// client/src/components/layout/ServerSidebar.tsx), sans recopie à la main.
//
//   node scripts/sync-server-templates.mjs [--ref <branche>] [--file <chemin>] [--check]
//
// Par défaut, lit le fichier web depuis la branche git `security-fixes` (le web n'est pas suivi
// sur toutes les branches). --check : n'écrit rien, échoue si le JSON du mobile diffère du web.
// Quand le web sera sur la même branche, il pourra importer ce JSON à son tour.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB_FILE = 'client/src/components/layout/ServerSidebar.tsx'
const OUT = join(dirname(fileURLToPath(import.meta.url)), '../src/features/servers/builtinServerTemplates.json')

const args = process.argv.slice(2)
const opt = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const check = args.includes('--check')
const file = opt('--file')
const ref = opt('--ref') ?? 'security-fixes'

const source = file ? readFileSync(file, 'utf8') : execFileSync('git', ['show', `${ref}:${WEB_FILE}`], { encoding: 'utf8' })

const start = source.indexOf('const BUILTIN_TEMPLATES = [')
if (start < 0) throw new Error(`BUILTIN_TEMPLATES introuvable dans ${file ?? `${ref}:${WEB_FILE}`}`)
// Le littéral se termine au premier « ] » en début de ligne qui suit.
const end = source.indexOf('\n]\n', start)
if (end < 0) throw new Error('Fin de BUILTIN_TEMPLATES introuvable')
const literal = source.slice(source.indexOf('[', start), end + 2)
// Littéral de données (objets, tableaux, chaînes, null) issu du dépôt : évalué tel quel.
const templates = new Function(`return ${literal}`)()
if (!Array.isArray(templates) || templates.length === 0) throw new Error('BUILTIN_TEMPLATES vide')

const json = `${JSON.stringify({ source: `${WEB_FILE} (BUILTIN_TEMPLATES)`, templates }, null, 2)}\n`

if (check) {
  let current = ''
  try {
    current = readFileSync(OUT, 'utf8')
  } catch {
    /* absent */
  }
  if (current !== json) {
    console.error('Les modèles intégrés du mobile diffèrent du web : relancer sans --check.')
    process.exit(1)
  }
  console.log(`OK : ${templates.length} modèles identiques au web.`)
} else {
  writeFileSync(OUT, json)
  console.log(`${templates.length} modèles écrits dans ${OUT}`)
}
