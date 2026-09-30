import { ALLOWED_UPLOAD_EXTENSIONS, LIMITS } from '@/config/env'
import { uploadExtension, validateAttachment } from '@/features/chat/useConversation'

/**
 * Copie de la liste `ALLOWED` du serveur pour un utilisateur normal, identique dans
 * handlers/uploads.rs (salon), friends.rs (DM) et group_dms.rs (groupe). À mettre à jour
 * avec le serveur : ce test signale tout écart.
 */
const SERVER_ALLOWED = [
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'webm', 'mov', 'mkv',
  'mp3', 'ogg', 'wav', 'flac', 'pdf', 'txt', 'md', 'zip', 'tar', 'gz', '7z',
  'rar', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'bin',
]

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
    for (const name of ['a.jpg', 'b.MP4', 'c.flac', 'd.pdf', 'e.tar.gz', 'f.pptx', 'README', 'g.bin']) {
      expect(validateAttachment(file(name))).toBeNull()
    }
  })

  it('refuse avant l’envoi ce que le serveur refuserait, avec un message explicite', () => {
    for (const name of ['memo.m4a', 'page.svg', 'setup.exe', 'script.js', 'photo.heic', 'bizarre.']) {
      const err = validateAttachment(file(name))
      expect(err).toMatch(/non autorisé par le serveur/)
      expect(err).toMatch(/Formats acceptés/)
    }
    expect(validateAttachment(file('memo.m4a'))).toMatch(/^Type de fichier \.m4a/)
  })

  it('refuse au-delà de 50 Mo', () => {
    expect(validateAttachment(file('a.mp4', LIMITS.uploadMaxBytes))).toBeNull()
    expect(validateAttachment(file('a.mp4', LIMITS.uploadMaxBytes + 1))).toMatch(/volumineux/)
  })
})
