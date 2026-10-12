// Sauvegarde chiffrée de l'historique (audit 2026-10-12, amélioration n° 30). Une conversation,
// déchiffrée sur l'appareil, est rescellée par une phrase secrète choisie à l'export :
// Argon2id (mêmes réglages que la clé de compte) → clé AES-256-GCM, AAD liée au format.
// Le fichier ne dépend ni du serveur ni du compte : lisible hors ligne avec la phrase seule
// (page /sauvegarde). Testé par scripts/historyBackup.test.mjs.
import { argon2idAsync } from '@noble/hashes/argon2.js'
import * as c from './crypto.ts'
import { ARGON2 } from './authKdf.ts'

export const BACKUP_FORMAT = 'forgechat-backup'
const AAD = 'forgechat backup v1'

export interface BackupMessage { at: string; author: string; text: string; files?: string[] }
export interface BackupPayload { conversation: string; exported_at: string; messages: BackupMessage[] }
interface Sealed {
  format: typeof BACKUP_FORMAT; v: 1
  kdf: { alg: 'argon2id'; t: number; m: number; p: number; salt: string }
  iv: string; ct: string
}

async function keyFrom(pass: string, salt: Uint8Array, p: { t: number; m: number; p: number }) {
  return argon2idAsync(new TextEncoder().encode(pass.normalize('NFKC')), salt, { ...p, dkLen: 32 })
}

export async function sealBackup(payload: BackupPayload, pass: string): Promise<string> {
  const salt = c.randomBytes(16)
  const iv = c.randomBytes(12)
  const key = await keyFrom(pass, salt, ARGON2)
  try {
    const ct = await c.aesGcmEncrypt(key, iv, new TextEncoder().encode(JSON.stringify(payload)), AAD)
    const sealed: Sealed = { format: BACKUP_FORMAT, v: 1, kdf: { alg: 'argon2id', ...ARGON2, salt: c.b64uEncode(salt) }, iv: c.b64uEncode(iv), ct: c.b64uEncode(ct) }
    return JSON.stringify(sealed)
  } finally {
    key.fill(0)
  }
}

/** Fichier + phrase → contenu ; erreur lisible si le fichier ou la phrase ne conviennent pas. */
export async function openBackup(text: string, pass: string): Promise<BackupPayload> {
  let s: Sealed
  try {
    s = JSON.parse(text)
  } catch {
    throw new Error('Ce fichier n’est pas une sauvegarde ForgeChat.')
  }
  if (s?.format !== BACKUP_FORMAT || s.v !== 1 || s.kdf?.alg !== 'argon2id') throw new Error('Ce fichier n’est pas une sauvegarde ForgeChat.')
  // Bornes : un fichier piégé ne doit pas bloquer l'appareil avec des réglages démesurés.
  const { t, m, p } = s.kdf
  if (!(t >= 1 && t <= 10 && m >= 8192 && m <= 262144 && p >= 1 && p <= 4)) throw new Error('Réglages de sauvegarde refusés.')
  const key = await keyFrom(pass, c.b64uDecode(s.kdf.salt), { t, m, p })
  try {
    const plain = await c.aesGcmDecrypt(key, c.b64uDecode(s.iv), c.b64uDecode(s.ct), AAD)
    return JSON.parse(new TextDecoder().decode(plain)) as BackupPayload
  } catch {
    throw new Error('Phrase secrète incorrecte (ou fichier modifié).')
  } finally {
    key.fill(0)
  }
}
