// Pièces jointes servies avec une URL signée (`/uploads/…?exp=&sig=`, F8 du 2026-10-10) : la
// signature est gardée pour télécharger, retirée pour comparer et pour la clé du cache d'images.
jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)), randomUUID: () => require('crypto').randomUUID() }))
import { imageSource, uploadPath } from '@/lib/links'
import { encryptedMedia } from '@/e2e/files'

describe('URL signées de /uploads (?exp=&sig=)', () => {
  const id = '0b5c7a2e-1f0d-4c3e-9a8b-7d6e5f4a3b2c'
  const signed = `/uploads/${id}.enc?exp=1760000000&sig=abc_-`

  it('chemin sans signature pour comparer et pour la clé de cache ; adresse signée gardée pour télécharger', () => {
    expect(uploadPath(signed)).toBe(`/uploads/${id}.enc`)
    expect(imageSource(`https://chat.example.org${signed}`)).toEqual({ uri: `https://chat.example.org${signed}`, cacheKey: `https://chat.example.org/uploads/${id}.enc` })
  })

  it('autres adresses inchangées (avatars publics, GIF avec paramètres)', () => {
    expect(uploadPath('/uploads/avatars/a.png')).toBe('/uploads/avatars/a.png')
    expect(uploadPath('https://media.giphy.com/media/x/giphy.gif?cid=1')).toBe('https://media.giphy.com/media/x/giphy.gif?cid=1')
  })

  it('média chiffré servi signé : reconnu, relié à sa clé, téléchargé avec la signature', () => {
    const entry = { id, k: 'k', n: 'a.png', m: 'image/png', s: 3, u: `/uploads/${id}.enc` }
    const att = encryptedMedia(signed, [entry])
    expect(att?.id).toBe(id)
    expect(att?.url).toBe(signed)
  })
})
