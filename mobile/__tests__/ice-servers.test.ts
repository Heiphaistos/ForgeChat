import { ICE_UNAVAILABLE, usableIceServers } from '@/api/voice'

describe('serveurs ICE (STUN/TURN)', () => {
  it('liste vide ou absente : erreur claire, aucun serveur public de repli', () => {
    expect(() => usableIceServers(undefined)).toThrow(ICE_UNAVAILABLE)
    expect(() => usableIceServers([])).toThrow(ICE_UNAVAILABLE)
    expect(() => usableIceServers('stun:x')).toThrow(ICE_UNAVAILABLE)
  })

  it('liste du serveur utilisée telle quelle', () => {
    const list = [{ urls: ['stun:turn.example.org:3478'] }, { urls: ['turn:turn.example.org:3478'], username: 'u', credential: 'p' }]
    expect(usableIceServers(list)).toBe(list)
  })

  it('aucune adresse de STUN public dans le code mobile', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require('node:fs') as typeof import('node:fs')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join } = require('node:path') as typeof import('node:path')
    const src = readFileSync(join(__dirname, '..', 'src', 'api', 'voice.ts'), 'utf8')
    expect(src).not.toMatch(/stun\.l\.google\.com|stun:stun/)
  })
})
