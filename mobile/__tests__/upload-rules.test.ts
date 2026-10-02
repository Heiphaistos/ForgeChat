import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { ALLOWED_UPLOAD_EXTENSIONS, LIMITS } from '@/config/env'
import { uploadExtension, validateAttachment } from '@/features/chat/useConversation'

/**
 * Liste `ATTACHMENT_EXTENSIONS` du serveur (server/src/media.rs), commune aux routes salon, DM et
 * groupe pour un utilisateur normal. Lue dans la source : tout écart fait échouer le test.
 */
const SERVER_ALLOWED = (() => {
  // Tant que le serveur n'est suivi que sur la branche security-fixes, on le lit depuis git si le
  // fichier n'est pas sur le disque (branche mobile seule extraite).
  const file = join(__dirname, '../../server/src/media.rs')
  const src = existsSync(file)
    ? readFileSync(file, 'utf8')
    : execFileSync('git', ['show', 'security-fixes:server/src/media.rs'], { encoding: 'utf8' })
  const block = src.match(/pub const ATTACHMENT_EXTENSIONS: &\[&str\] = &\[([^\]]*)\]/)
  if (!block) throw new Error('ATTACHMENT_EXTENSIONS introuvable dans server/src/media.rs')
  return [...(block[1] ?? '').matchAll(/"([a-z0-9]+)"/g)].map((m) => m[1])
})()

const file = (name: string, size = 1000) => ({ uri: 'file://x', name, type: 'application/octet-stream', size })

describe('règles d’upload alignées sur le serveur (salon, DM, groupe)', () => {
  it('même liste d’extensions que le serveur', () => {
    expect([...ALLOWED_UPLOAD_EXTENSIONS].sort()).toEqual([...SERVER_ALLOWED].sort())
    expect(LIMITS.uploadMaxBytes).toBe(52_428_800) // MAX_UPLOAD_SIZE par défaut (config.rs)
  })

  it('lit l’extension comme Rust Path::extension, « bin » à défaut', () => {
    expect(uploadExtension('photo.JPG')).toBe('jpg')
    expect(uploadExtension('archive.tar.gz')).toBe('gz')
    expect(uploadExtension('README')).toBe('bin')
    expect(uploadExtension('.env')).toBe('bin')
    expect(uploadExtension('dossier/sous.dossier/note')).toBe('bin')
    expect(uploadExtension('bizarre.')).toBe('')
  })

  it('accepte ce que le serveur accepte, y compris sans extension', () => {
    for (const name of ['a.jpg', 'b.MP4', 'c.flac', 'memo.m4a', 'voix.AAC', 'd.pdf', 'e.tar.gz', 'f.pptx', 'README', 'g.bin']) {
      expect(validateAttachment(file(name))).toBeNull()
    }
  })

  it('refuse avant l’envoi ce que le serveur refuserait, avec un message explicite', () => {
    for (const name of ['page.svg', 'setup.exe', 'script.js', 'photo.heic', 'bizarre.']) {
      const err = validateAttachment(file(name))
      expect(err).toMatch(/non autorisé par le serveur/)
      expect(err).toMatch(/Formats acceptés/)
    }
    expect(validateAttachment(file('photo.heic'))).toMatch(/^Type de fichier \.heic/)
  })

  it('refuse au-delà de 50 Mo', () => {
    expect(validateAttachment(file('a.mp4', LIMITS.uploadMaxBytes))).toBeNull()
    expect(validateAttachment(file('a.mp4', LIMITS.uploadMaxBytes + 1))).toMatch(/volumineux/)
  })
})
