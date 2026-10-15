// Commandes slash : mise en forme et clés i18n de l'onglet : node --test scripts/commands.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commandUsage } from '../src/lib/commandTypes.ts'
import { fr, en } from '../src/i18n/parts/commands.ts'

test('usage : obligatoires entre <>, facultatives entre []', () => {
  const opt = (name, required) => ({ name, description: '', type: 'string', required })
  assert.equal(commandUsage({ name: 'ping', options: [] }), '/ping')
  assert.equal(commandUsage({ name: 'kick', options: [opt('user', true), opt('reason', false)] }), '/kick <user> [reason]')
})

test('toutes les clés anglaises existent en français, mêmes variables', () => {
  const vars = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join()
  for (const [k, v] of Object.entries(en)) {
    assert.ok(k in fr, `clé en trop : ${k}`)
    assert.equal(vars(v), vars(fr[k]), `variables différentes : ${k}`)
  }
  assert.equal(Object.keys(en).length, Object.keys(fr).length, 'tout est traduit')
})

test('un libellé existe pour chaque permission proposée à un bot', () => {
  for (const p of ['MANAGE_MESSAGES', 'KICK_MEMBERS', 'BAN_MEMBERS', 'BAN_TEMP', 'MANAGE_ROLES', 'MANAGE_CHANNELS', 'EDIT_CHANNELS', 'MANAGE_NICKNAMES', 'MANAGE_SERVER', 'ADMINISTRATOR', 'everyone', 'owner']) {
    assert.ok(`cmd.perm.${p}` in fr, p)
  }
})
