import { ALLOWED_UPLOAD_EXTENSIONS, LIMITS } from '@/config/env'
import { uploadExtension, validateAttachment } from '@/features/chat/useConversation'

/**
 * Extensions acceptées par le serveur de référence (dépôt de Heiphaistos, commit 2dae54d) pour un
 * utilisateur normal : listes identiques dans server/src/handlers/uploads.rs (ALLOWED_EXTENSIONS,
 * salons), friends.rs (DM) et group_dms.rs (groupes). À mettre à jour si le serveur change sa liste.
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
    for (const name of ['page.svg', 'setup.exe', 'script.js', 'photo.heic', 'memo.m4a', 'voix.AAC', 'bizarre.']) {
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
