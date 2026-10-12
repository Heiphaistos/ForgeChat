// Mots de passe ayant fuité (amélioration n° 6) : seul le préfixe de 5 caractères part.
import { pwnedCount, pwnedProblem } from '@/e2e/pwned'

// SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
const RANGE = '0018A45C4D1DEF81644B54AB7F969B88D65:1\n1E4C9B93F3F0682250B6CF8331B7EE68FD8:10434004\n'

test('préfixe seul envoyé, suite comparée sur l’appareil', async () => {
  const asked: string[] = []
  expect(await pwnedCount('password', async p => { asked.push(p); return RANGE })).toBe(10434004)
  expect(asked).toEqual(['5BAA6'])
  expect(await pwnedCount('absent du tout 9!x', async () => RANGE)).toBe(0)
})

test('service injoignable : rien n’est bloqué', async () => {
  expect(await pwnedProblem('password', async () => { throw new Error('hors ligne') })).toBeNull()
  expect(await pwnedProblem('password', async () => RANGE)).toMatch(/fuites de données/)
})
