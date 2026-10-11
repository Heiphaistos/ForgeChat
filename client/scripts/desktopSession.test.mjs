// Reprise de session du bureau au lancement : node --test scripts/desktopSession.test.mjs
// Non-régression : un rafraîchissement raté une fois (réseau, 502) au lancement envoyait /users/me sans
// jeton ; son 401 passait pour un refus définitif et effaçait la session du trousseau (reconnexion à
// chaque lancement).
import { test } from 'node:test'
import assert from 'node:assert/strict'

// Faux pont Tauri : session_refresh répond selon `script`, chaque appel est noté.
let script = []
const calls = []
globalThis.window = {
  __TAURI_INTERNALS__: {
    invoke: async (cmd) => {
      calls.push(cmd)
      if (cmd === 'session_access') return null
      if (cmd === 'session_refresh') {
        const next = script.shift()
        if (typeof next === 'number') throw next
        return next
      }
      return null
    },
  },
}
const { accessToken, resumeSession, setAccessToken } = await import('../src/lib/localSession.ts')
const noWait = async () => {}
const reset = (s) => { script = s; calls.length = 0; setAccessToken(null) }

test('panne passagère au lancement : réessayée, la session reprend, rien n\'est effacé', async () => {
  reset([502, 0, 'acc-1'])
  assert.equal(await resumeSession(noWait), true)
  assert.equal(accessToken(), 'acc-1')
  assert.equal(calls.filter(c => c === 'session_refresh').length, 3)
  assert.ok(!calls.includes('session_clear'))
})

test('refus du serveur : pas de session, sans nouvel essai', async () => {
  for (const s of [400, 401, 403]) {
    reset([s, 'jamais'])
    assert.equal(await resumeSession(noWait), false)
    assert.deepEqual(calls.filter(c => c === 'session_refresh'), ['session_refresh'])
  }
})

test('toujours injoignable : abandon après 4 essais, trousseau intact', async () => {
  reset([0, 0, 0, 0, 'trop tard'])
  assert.equal(await resumeSession(noWait), false)
  assert.equal(calls.filter(c => c === 'session_refresh').length, 4)
  assert.ok(!calls.includes('session_clear'))
})

test('jeton d\'accès déjà en mémoire (rechargement) : aucun rafraîchissement', async () => {
  reset([])
  setAccessToken('acc-mem')
  assert.equal(await resumeSession(noWait), true)
  assert.ok(!calls.includes('session_refresh'))
})
