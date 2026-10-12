// Mise à jour iOS : l'IPA est hachée par morceaux sur l'appareil avant d'être remise à AltStore.
jest.mock('expo-linking', () => ({ openURL: jest.fn() }))
import { createHash } from 'crypto'
import { sha256File } from '@/features/updates/installer'

test('SHA-256 identique à celui du fichier entier, lu par morceaux', () => {
  const data = new Uint8Array(3 * (1 << 20) + 12345).map((_, i) => (i * 31) % 251)
  let pos = 0
  let closed = false
  const handle = {
    readBytes: (n: number) => { const b = data.subarray(pos, pos + n); pos += b.length; return b },
    close: () => { closed = true },
  }
  expect(sha256File(() => handle)).toBe(createHash('sha256').update(data).digest('hex'))
  expect(closed).toBe(true)
})
