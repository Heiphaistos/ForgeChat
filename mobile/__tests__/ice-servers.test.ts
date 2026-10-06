import { relayOnly } from '@/api/voice'

describe('serveurs ICE passés à LiveKit', () => {
  it('ne garde que les relais TURN (jamais de STUN, public ou non)', () => {
    const list = [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
      { urls: 'stun:turn.example.org:3478' },
      { urls: ['turn:turn.example.org:3478', 'stun:turn.example.org:3478'], username: 'u', credential: 'p' },
      { urls: 'turns:turn.example.org:5349', username: 'u', credential: 'p' },
    ]
    expect(relayOnly(list)).toEqual([
      { urls: ['turn:turn.example.org:3478'], username: 'u', credential: 'p' },
      { urls: ['turns:turn.example.org:5349'], username: 'u', credential: 'p' },
    ])
    expect(JSON.stringify(relayOnly(list))).not.toMatch(/stun|google/)
  })

  it('entrées invalides ignorées', () => {
    expect(relayOnly(undefined)).toEqual([])
    expect(relayOnly([null, {}, { urls: 42 }, { urls: ['http://x'] }])).toEqual([])
  })

  it('aucune adresse de STUN public dans le code de l’app', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync, readdirSync, statSync } = require('node:fs') as typeof import('node:fs')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join } = require('node:path') as typeof import('node:path')
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : /\.tsx?$/.test(f) ? [join(d, f)] : []))
    for (const f of walk(join(__dirname, '..', 'src'))) {
      expect({ f, google: /stun\.l\.google\.com|stun\d?\.l\.google/.test(readFileSync(f, 'utf8')) }).toEqual({ f, google: false })
    }
  })
})
