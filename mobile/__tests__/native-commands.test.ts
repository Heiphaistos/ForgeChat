import { existsSync, readFileSync } from 'fs'
import { NATIVE_COMMANDS } from '@/e2e/nativeCommands'

test('26 commandes natives, noms connus, pas celles du composeur', () => {
  expect(NATIVE_COMMANDS.size).toBe(26)
  for (const n of ['kick', 'ban', 'help', '8ball']) expect(NATIVE_COMMANDS.has(n)).toBe(true)
  expect(NATIVE_COMMANDS.has('giphy')).toBe(false)
})

const SRC = '../server/src/handlers/commands/native.rs'
;(existsSync(SRC) ? test : test.skip)('identique au serveur (si les sources sont là)', () => {
  const names = [...readFileSync(SRC, 'utf8').matchAll(/NativeDef \{ name: "([^"]+)"/g)].map((m) => m[1])
  expect([...NATIVE_COMMANDS].sort()).toEqual(names.sort())
})
