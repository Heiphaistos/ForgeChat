// Code de sécurité en QR (amélioration n° 11).
import QRCode from 'qrcode'
import { compareSafetyScan, qrRows, safetyPayload } from '@/e2e/safetyQr'

const code = '0123456789'.repeat(6)

test('égalité stricte des 60 chiffres', () => {
  expect(compareSafetyScan(safetyPayload(code), code)).toBe('match')
  expect(compareSafetyScan(safetyPayload(code.slice(0, 59) + '0'), code)).toBe('mismatch')
  expect(compareSafetyScan('https://evil.example', code)).toBe('invalid')
})

test('la matrice dessinée reproduit le QR (segments fusionnés)', () => {
  const text = safetyPayload(code)
  const { size, rows } = qrRows(text)
  const { data } = QRCode.create(text, { errorCorrectionLevel: 'M' }).modules
  for (let y = 0; y < size; y++) {
    const line = new Array(size).fill(false)
    for (const [x, w] of rows[y]!) for (let i = x; i < x + w; i++) line[i] = true
    expect(line).toEqual(Array.from({ length: size }, (_, x) => !!data[y * size + x]))
  }
})
