// Fichiers chiffrés sur mobile (src/e2e/files.ts, §12) : chiffrement dans le cache, blob
// opaque envoyé, déchiffrement d'un blob téléchargé, effacement des fichiers temporaires.
// Le module natif FileSystem est remplacé par un disque en mémoire ; le chemin JavaScript
// (sans module natif ForgeCallService) et le chemin natif (appels vérifiés) sont testés.

const mockDisk = new Map<string, Uint8Array>()
const mockServer = new Map<string, Uint8Array>()
const mockNative: { encryptFile?: jest.Mock; decryptFile?: jest.Mock } = {}

jest.mock('expo', () => {
  class Handle {
    off = 0
    path: string
    constructor(p: string) { this.path = p }
    readBytes(n: number) {
      const b = mockDisk.get(this.path) ?? new Uint8Array(0)
      const out = b.slice(this.off, this.off + n)
      this.off += out.length
      return out
    }
    writeBytes(chunk: Uint8Array) {
      const b = mockDisk.get(this.path) ?? new Uint8Array(0)
      const out = new Uint8Array(b.length + chunk.length)
      out.set(b)
      out.set(chunk, b.length)
      mockDisk.set(this.path, out)
    }
    close() {}
  }
  class FileSystemFile {
    uri: string
    constructor(u: string) { this.uri = u }
    get exists() { return mockDisk.has(this.uri) }
    delete() { mockDisk.delete(this.uri) }
    create() { mockDisk.set(this.uri, new Uint8Array(0)) }
    open() { return new Handle(this.uri) }
  }
  class FileSystemDirectory {
    uri: string
    constructor(u: string) { this.uri = u }
    get exists() { return true }
    create() {}
    delete() { for (const k of [...mockDisk.keys()]) if (k.startsWith(this.uri)) mockDisk.delete(k) }
  }
  const fs = {
    FileSystemFile,
    FileSystemDirectory,
    cacheDirectory: 'file:///cache/',
    downloadFileAsync: async (url: string, to: FileSystemFile) => {
      const b = mockServer.get(url)
      if (!b) throw new Error('404')
      mockDisk.set(to.uri, b.slice())
      return to.uri
    },
  }
  return {
    // Module natif lu à l'appel (le module testé le récupère au chargement, avant ce fichier).
    requireOptionalNativeModule: (name: string) =>
      name === 'FileSystem' ? fs : name === 'ForgeCallService' ? new Proxy({}, { get: (_t, k: string) => (mockNative as Record<string, unknown>)[k] }) : null,
  }
})
jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)),
  randomUUID: () => require('crypto').randomUUID(),
}))
jest.mock('@/lib/links', () => ({ resolveMediaUrl: (u: string) => `https://forge.test${u}` }))
const mockMustEncrypt = jest.fn()
jest.mock('@/e2e/conversations', () => ({ mustEncrypt: (...a: unknown[]) => mockMustEncrypt(...a) }))

import * as c from '@/e2e/crypto'
import { clearFileCache, decryptToCache, displayAttachments, encryptedMedia, MOBILE_MAX_ENCRYPTED, prepareUploads, thumbUri } from '@/e2e/files'

const pattern = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 13 + 5) & 255)

beforeEach(() => {
  mockDisk.clear()
  mockServer.clear()
  delete mockNative.encryptFile
  delete mockNative.decryptFile
  mockMustEncrypt.mockResolvedValue(true)
})

test('conversation chiffrée : blob opaque <id>.enc, clé dans l’entrée, aller-retour exact, cache effacé', async () => {
  const plain = pattern(c.FILE_CHUNK * 2 + 123)
  mockDisk.set('file:///picked/photo.jpg', plain)
  const p = await prepareUploads('dm', 'dm-1', [{ uri: 'file:///picked/photo.jpg', name: 'photo.jpg', type: 'image/jpeg', size: plain.length }])
  const e = p.entries![0]!
  const up = p.uploads[0]!
  expect(up.name).toBe(`${e.id}.enc`)
  expect(up.type).toBe('application/octet-stream')
  expect(e).toMatchObject({ n: 'photo.jpg', m: 'image/jpeg', s: plain.length })
  const blob = mockDisk.get(up.uri)!
  expect(blob.length).toBe(c.encryptedFileSize(plain.length))
  // Aucun octet du fichier en clair dans le blob (premier morceau comparé).
  expect(Buffer.from(blob).includes(Buffer.from(plain.subarray(0, 64)))).toBe(false)
  // Même format que le web : le blob se déchiffre avec les primitives communes.
  expect(await c.decryptFileBytes(c.b64uDecode(e.k), e.id, blob, plain.length)).toEqual(plain)

  // Réception : téléchargé, déchiffré dans le cache, blob téléchargé effacé.
  mockServer.set('https://forge.test/uploads/x.enc', blob)
  p.cleanup()
  expect(mockDisk.has(up.uri)).toBe(false)
  const uri = await decryptToCache('/uploads/x.enc', e)
  expect(uri).toMatch(/\.jpg$/)
  expect(mockDisk.get(uri)).toEqual(plain)
  expect([...mockDisk.keys()].some((k) => k.endsWith('.dl'))).toBe(false)
  clearFileCache()
  expect(mockDisk.has(uri)).toBe(false)
})

test('blob altéré : refus, aucun fichier en clair laissé dans le cache', async () => {
  const plain = pattern(5000)
  mockDisk.set('file:///a.txt', plain)
  const p = await prepareUploads('channel', 'ch', [{ uri: 'file:///a.txt', name: 'a.txt', type: 'text/plain', size: plain.length }])
  const e = p.entries![0]!
  const bad = mockDisk.get(p.uploads[0]!.uri)!.slice()
  bad[7] = bad[7]! ^ 1
  mockServer.set('https://forge.test/uploads/bad.enc', bad)
  await expect(decryptToCache('/uploads/bad.enc', e)).rejects.toThrow()
  expect([...mockDisk.keys()].filter((k) => k.includes(e.id) && !k.endsWith('.enc'))).toEqual([])
})

test('conversation en clair (transition) : fichiers envoyés tels quels, sans entrée', async () => {
  mockMustEncrypt.mockResolvedValue(false)
  const f = { uri: 'file:///a.png', name: 'a.png', type: 'image/png', size: 3 }
  const p = await prepareUploads('group', 'g', [f])
  expect(p.entries).toBeUndefined()
  expect(p.uploads).toEqual([f])
})

test('limite mobile de 100 Mo, dite par E2E_FILE_TOO_BIG', async () => {
  await expect(prepareUploads('dm', 'd', [{ uri: 'file:///big', name: 'big.zip', type: 'application/zip', size: MOBILE_MAX_ENCRYPTED + 1 }]))
    .rejects.toThrow('E2E_FILE_TOO_BIG')
})

test('Android : chiffrement et déchiffrement natifs en flux (clé en base64 standard)', async () => {
  mockNative.encryptFile = jest.fn(async (_src: string, dest: string) => { mockDisk.set(dest, new Uint8Array(32)); return 16 })
  mockNative.decryptFile = jest.fn(async (_src: string, dest: string) => { mockDisk.set(dest, new Uint8Array(16)); return null })
  const p = await prepareUploads('dm', 'd', [{ uri: 'content://media/42', name: 'v.mp4', type: 'video/mp4' }])
  const e = p.entries![0]!
  const [src, dest, key, id] = mockNative.encryptFile.mock.calls[0]!
  expect(src).toBe('content://media/42')
  expect(dest).toBe(p.uploads[0]!.uri)
  expect(id).toBe(e.id)
  expect(Buffer.from(key, 'base64')).toEqual(Buffer.from(c.b64uDecode(e.k)))
  expect(e.s).toBe(16)
  mockServer.set('https://forge.test/uploads/v.enc', new Uint8Array(32))
  await decryptToCache('/uploads/v.enc', e)
  expect(mockNative.decryptFile.mock.calls[0]!.slice(2)).toEqual([key, e.id, 16])
})

test('affichage : blobs reliés à leurs entrées, blob sans clé verrouillé, média de publication', () => {
  const e: c.FileEntry = { id: '11111111-1111-4111-8111-111111111111', k: c.b64uEncode(new Uint8Array(32)), n: 'voice-1.webm', m: 'audio/webm', s: 9, u: '/uploads/z.enc', th: 'AQID' }
  const atts = [
    { id: 'a', url: '/uploads/r.enc', filename: `${e.id}.enc`, content_type: 'application/octet-stream', size: 25 },
    { id: 'b', url: '/uploads/s.enc', filename: '22222222-2222-4222-8222-222222222222.enc', content_type: 'application/octet-stream', size: 25 },
    { id: 'c', url: '/uploads/old.png', filename: 'old.png', content_type: 'image/png', size: 3 },
  ]
  const [a, b, plain] = displayAttachments(atts, [e])
  expect(a).toMatchObject({ filename: 'voice-1.webm', content_type: 'audio/webm', size: 9, e2e: e })
  expect(b).toMatchObject({ e2eLocked: true })
  expect(plain).toEqual(atts[2])
  expect(encryptedMedia('/uploads/z.enc', [e])).toMatchObject({ filename: `${e.id}.enc`, size: 9 })
  expect(encryptedMedia('/uploads/z.png', [e])).toBeNull()
  expect(thumbUri(e)).toBe('data:image/jpeg;base64,AQID')
})
