// Liste locale des commandes natives : node --test scripts/nativeCommands.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { NATIVE_COMMANDS } from '../src/e2e/nativeCommands.ts'

test('26 commandes natives, noms connus', () => {
  assert.equal(NATIVE_COMMANDS.size, 26)
  for (const n of ['kick', 'ban', 'help', '8ball']) assert.ok(NATIVE_COMMANDS.has(n))
  assert.ok(!NATIVE_COMMANDS.has('giphy'))
})

test('identique au serveur (si les sources sont là)', { skip: !existsSync('../server/src/handlers/commands/native.rs') }, () => {
  const src = readFileSync('../server/src/handlers/commands/native.rs', 'utf8')
  const names = [...src.matchAll(/NativeDef \{ name: "([^"]+)"/g)].map(m => m[1])
  assert.deepEqual([...NATIVE_COMMANDS].sort(), names.sort())
})
