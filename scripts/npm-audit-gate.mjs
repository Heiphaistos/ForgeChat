#!/usr/bin/env node
// Barrière d'audit npm (audit 2026-10-12, amélioration n° 21).
// Usage : node scripts/npm-audit-gate.mjs <dossier> <liste-d-exceptions.json>
// Échoue sur toute vulnérabilité `high`/`critical` des dépendances livrées (`--omit=dev`), sauf
// les avis (GHSA) examinés et justifiés dans le fichier d'exceptions. Une exception expirée
// (`until` dépassé) redevient bloquante : elle doit être réexaminée.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const [dir, allowFile] = process.argv.slice(2)
if (!dir) {
  console.error('usage : npm-audit-gate.mjs <dossier> [exceptions.json]')
  process.exit(2)
}
const allow = allowFile ? JSON.parse(readFileSync(allowFile, 'utf8')).advisories ?? {} : {}
const today = new Date().toISOString().slice(0, 10)

let raw
try {
  raw = execFileSync('npm', ['audit', '--omit=dev', '--json'], { cwd: dir, encoding: 'utf8', maxBuffer: 64 << 20 })
} catch (e) {
  raw = e.stdout // npm audit sort en erreur dès qu'il trouve quelque chose
}
const report = JSON.parse(raw)
const seen = new Map()
for (const v of Object.values(report.vulnerabilities ?? {})) {
  for (const via of v.via) {
    if (typeof via !== 'object' || !['high', 'critical'].includes(via.severity)) continue
    const id = via.url?.split('/').pop() ?? via.title
    seen.set(id, { pkg: via.name, title: via.title, severity: via.severity })
  }
}
let failed = false
for (const [id, a] of seen) {
  const ok = allow[id]
  if (ok && (!ok.until || ok.until >= today)) {
    console.log(`exception ${id} (${a.pkg}) : ${ok.reason}`)
    continue
  }
  failed = true
  console.error(`BLOQUANT ${a.severity} ${id} ${a.pkg} — ${a.title}${ok ? ` (exception expirée le ${ok.until})` : ''}`)
}
console.log(`${seen.size} avis high/critical, ${failed ? 'échec' : 'aucun bloquant'}`)
process.exit(failed ? 1 : 0)
