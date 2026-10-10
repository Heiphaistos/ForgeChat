// Lien masqué trompeur (même cas que client/scripts/safeUrl.test.mjs).
import { deceptiveHost } from '@/lib/safeUrl'

test('lien masqué trompeur : hôte réel affiché', () => {
  expect(deceptiveHost('paypal.com', 'https://evil.example/login')).toBe('evil.example')
  expect(deceptiveHost('https://paypal.com/login', 'https://paypal.com.evil.example/')).toBe('paypal.com.evil.example')
  expect(deceptiveHost('pаypal.com', 'https://paypal.com')).toBe('paypal.com') // « а » cyrillique
})

test('lien masqué honnête ou simple texte : rien à ajouter', () => {
  expect(deceptiveHost('Clique ici', 'https://evil.example')).toBeNull()
  expect(deceptiveHost('www.google.com', 'https://google.com/x')).toBeNull()
  expect(deceptiveHost('google.com', 'https://mail.google.com')).toBeNull()
  expect(deceptiveHost('version 1.2', 'https://a.fr')).toBeNull()
})
