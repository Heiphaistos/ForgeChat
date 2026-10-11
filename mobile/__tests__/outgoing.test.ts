import { cleanUrl, cleanUrls, convertEmoticons, prepareOutgoing } from '@/lib/outgoing'

/** Mêmes cas que le web (client/scripts/outgoing.test.mjs) : appliqué AVANT chiffrement. */
describe('outgoing', () => {
  it('retire les paramètres de pistage, garde le reste', () => {
    expect(cleanUrl('https://a.fr/x?utm_source=n&id=3&fbclid=z')).toBe('https://a.fr/x?id=3')
    expect(cleanUrl('https://youtu.be/abc?si=xyz')).toBe('https://youtu.be/abc')
    expect(cleanUrl('https://a.fr/x?si=garde')).toBe('https://a.fr/x?si=garde')
    expect(cleanUrls('vois https://a.fr/?gclid=1. ok')).toBe('vois https://a.fr/. ok')
    expect(cleanUrls('`https://a.fr/?utm_x=1`')).toBe('`https://a.fr/?utm_x=1`')
  })

  it('émoticônes hors code, jamais dans une adresse ou une mention', () => {
    expect(convertEmoticons('salut :) <3')).toBe('salut 🙂 ❤️')
    expect(convertEmoticons('http://a.fr/x :D')).toBe('http://a.fr/x 😃')
    expect(convertEmoticons('`:)`')).toBe('`:)`')
    expect(convertEmoticons('<@11111111-1111-1111-1111-111111111111> ok')).toBe('<@11111111-1111-1111-1111-111111111111> ok')
  })

  it('selon les réglages', () => {
    const text = 'https://a.fr/?utm_a=1 :)'
    expect(prepareOutgoing(text, { cleanUrls: false, convertEmoticons: false })).toBe(text)
    expect(prepareOutgoing(text, { cleanUrls: true, convertEmoticons: true })).toBe('https://a.fr/ 🙂')
  })
})
