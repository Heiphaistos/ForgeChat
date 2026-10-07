// Fichiers et pièces jointes chiffrés de bout en bout sur mobile (docs/CHIFFREMENT-E2E.md §12).
// Même format que le web (e2e/crypto.ts : morceaux de 64 Kio). Envoi : le fichier choisi est
// chiffré dans le cache de l'appli, ce blob opaque `<id>.enc` part au serveur, puis il est
// effacé ; la clé et la description vont dans le message chiffré (`f`). Réception : le blob
// est téléchargé dans le cache, déchiffré dans un fichier temporaire lu par les lecteurs
// intégrés, puis le blob chiffré est effacé (le cache entier est vidé au démarrage).
// Android : chiffrement natif en flux (ForgeCallService, FileCrypto.java), rien en mémoire ;
// ailleurs (iOS, anciennes versions natives) : même calcul en JavaScript, morceau par morceau.
import { requireOptionalNativeModule } from 'expo'
import * as Crypto from 'expo-crypto'
import type { UploadFile } from '@/api/messages'
import { resolveMediaUrl } from '@/lib/links'
import type { Attachment } from '@/types/models'
import { mustEncrypt, type ConvKind } from './conversations'
import * as c from './crypto'

/** Limite d'un fichier chiffré sur mobile (le web garde 500 Mo) : dite dans l'interface. */
export const MOBILE_MAX_ENCRYPTED = 100 * 1024 * 1024

// Module natif FileSystem (expo-file-system, déjà lié dans l'appli par expo) : seule la partie utilisée.
interface NativeHandle { readBytes(n: number): Uint8Array; writeBytes(b: Uint8Array): void; close(): void }
interface NativeFile { readonly uri: string; readonly exists: boolean; delete(): void; create(o?: { overwrite?: boolean }): void; open(mode?: string): NativeHandle }
interface NativeDir { readonly exists: boolean; create(o?: { intermediates?: boolean; idempotent?: boolean }): void; delete(): void }
interface FsModule {
  FileSystemFile: new (uri: string) => NativeFile
  FileSystemDirectory: new (uri: string) => NativeDir
  cacheDirectory: string
  downloadFileAsync(url: string, to: NativeFile, options?: { idempotent?: boolean }): Promise<string>
  pickDirectoryAsync?(initialUri?: string): Promise<{ createFile(name: string, mimeType: string | null): NativeFile }>
}
interface NativeFileCrypto {
  encryptFile?: (src: string, dest: string, keyB64: string, fileId: string) => Promise<number>
  decryptFile?: (src: string, dest: string, keyB64: string, fileId: string, size: number) => Promise<null>
}

const fs = requireOptionalNativeModule<FsModule>('FileSystem')
const native = requireOptionalNativeModule<NativeFileCrypto>('ForgeCallService')

/** Base64 standard (attendu par le module natif). */
const b64Std = (k: Uint8Array) => {
  const u = c.b64uEncode(k).replace(/-/g, '+').replace(/_/g, '/')
  return u + '='.repeat((4 - (u.length % 4)) % 4)
}

function cacheDir(): string {
  if (!fs) throw new Error('E2E_FILES_UNAVAILABLE')
  const uri = `${fs.cacheDirectory.replace(/\/?$/, '/')}e2e-files/`
  const dir = new fs.FileSystemDirectory(uri)
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true })
  return uri
}

const cacheFile = (name: string) => new fs!.FileSystemFile(cacheDir() + name)

/** Efface les fichiers temporaires (déchiffrés ou chiffrés) d'une session précédente. */
export function clearFileCache() {
  try {
    if (!fs) return
    const dir = new fs.FileSystemDirectory(`${fs.cacheDirectory.replace(/\/?$/, '/')}e2e-files/`)
    if (dir.exists) dir.delete()
  } catch { /* cache déjà vide ou occupé : au prochain démarrage */ }
}

function safeDelete(f: NativeFile | null) {
  try { if (f?.exists) f.delete() } catch { /* fichier déjà effacé */ }
}

/** Chiffrement en JavaScript, morceau par morceau (iOS, ou module natif ancien). */
async function encryptJs(src: string, out: NativeFile, key: Uint8Array, id: string): Promise<number> {
  const cipher = await c.fileCipher(key)
  const input = new fs!.FileSystemFile(src).open('r')
  out.create({ overwrite: true })
  const output = out.open('w')
  try {
    let cur = input.readBytes(c.FILE_CHUNK)
    let total = 0
    for (let i = 0; ; i++) {
      const next = cur.length === c.FILE_CHUNK ? input.readBytes(c.FILE_CHUNK) : new Uint8Array(0)
      const last = next.length === 0
      output.writeBytes(await cipher.encrypt(id, i, last, cur))
      total += cur.length
      if (total > MOBILE_MAX_ENCRYPTED) throw new Error('E2E_FILE_TOO_BIG')
      if (last) return total
      cur = next
    }
  } finally {
    input.close()
    output.close()
  }
}

async function decryptJs(src: NativeFile, out: NativeFile, key: Uint8Array, id: string, size: number) {
  const dec = new c.FileDecryptor(await c.fileCipher(key), id, size)
  const input = src.open('r')
  out.create({ overwrite: true })
  const output = out.open('w')
  try {
    for (;;) {
      const chunk = input.readBytes(c.FILE_CT_CHUNK)
      if (!chunk.length) break
      for (const p of await dec.push(chunk)) output.writeBytes(p)
    }
    output.writeBytes(await dec.end())
  } finally {
    input.close()
    output.close()
  }
}

/** Fichier prêt à l'envoi : blob chiffré dans le cache et son entrée (clé, nom, type, taille). */
export async function sealUpload(f: UploadFile): Promise<{ entry: c.FileEntry; upload: UploadFile; blob: NativeFile }> {
  if (f.size != null && f.size > MOBILE_MAX_ENCRYPTED) throw new Error('E2E_FILE_TOO_BIG')
  const id = Crypto.randomUUID()
  const key = c.randomBytes(32)
  const blob = cacheFile(c.blobName(id))
  try {
    const size = native?.encryptFile
      ? await native.encryptFile(f.uri, blob.uri, b64Std(key), id)
      : await encryptJs(f.uri, blob, key, id)
    if (size > MOBILE_MAX_ENCRYPTED) throw new Error('E2E_FILE_TOO_BIG')
    const entry: c.FileEntry = { id, k: c.b64uEncode(key), n: f.name || 'fichier', m: f.type || 'application/octet-stream', s: size }
    return { entry, blob, upload: { uri: blob.uri, name: c.blobName(id), type: 'application/octet-stream', size: c.encryptedFileSize(size) } }
  } catch (e) {
    safeDelete(blob)
    throw e
  }
}

/** Fichiers d'un envoi : chiffrés si la conversation l'exige (`entries` à mettre dans le message chiffré). */
export interface PreparedUploads { entries?: c.FileEntry[]; uploads: UploadFile[]; cleanup: () => void }

export async function prepareUploads(kind: ConvKind, id: string, files: UploadFile[]): Promise<PreparedUploads> {
  if (!files.length || !(await mustEncrypt(kind, id))) return { uploads: files, cleanup: () => undefined }
  const sealed: Awaited<ReturnType<typeof sealUpload>>[] = []
  const cleanup = () => sealed.forEach((s) => safeDelete(s.blob))
  try {
    for (const f of files) sealed.push(await sealUpload(f))
  } catch (e) {
    cleanup()
    throw e
  }
  return { entries: sealed.map((s) => s.entry), uploads: sealed.map((s) => s.upload), cleanup }
}

/** Prépare, envoie, puis efface toujours les blobs chiffrés du cache. */
export async function withPreparedUploads<T>(kind: ConvKind, id: string, files: UploadFile[], fn: (p: PreparedUploads) => Promise<T>): Promise<T> {
  const p = await prepareUploads(kind, id, files)
  try {
    return await fn(p)
  } finally {
    p.cleanup()
  }
}

/** Contenu chiffré additionnel d'un envoi avec fichiers. */
export const filesExtra = (p: { entries?: c.FileEntry[] } | null | undefined): Record<string, unknown> | undefined =>
  p?.entries?.length ? { f: p.entries } : undefined

// ─── Réception ──────────────────────────────────────────────────────────────
/** Pièce jointe à afficher : `e2e` = fichier chiffré et sa clé ; `e2eLocked` = blob sans clé lisible. */
export type DisplayAttachment = Attachment & { e2e?: c.FileEntry; e2eLocked?: boolean }

const isBlob = (a: Attachment) => a.content_type === 'application/octet-stream' && /\.enc$/.test(a.filename)

/** Relie les blobs chiffrés du serveur aux fichiers décrits dans le message déchiffré (même règle que le web). */
export function displayAttachments(atts: Attachment[], files: c.FileEntry[] | null | undefined): DisplayAttachment[] {
  const byName = new Map((files ?? []).map((e) => [c.blobName(e.id), e]))
  return atts.map((a) => {
    const e = isBlob(a) ? byName.get(a.filename) : undefined
    if (e) return { ...a, filename: e.n, content_type: c.safeMime(e.m), size: e.s, e2e: e }
    return isBlob(a) ? { ...a, e2eLocked: true } : a
  })
}

/** Média chiffré d'une publication, cité par son adresse (`u`) : pièce jointe à afficher ; null si en clair. */
export function encryptedMedia(url: string, files: c.FileEntry[] | null | undefined): Attachment | null {
  if (!/\.enc$/.test(url)) return null
  const e = files?.find((f) => f.u === url)
  return { id: e?.id ?? url, url, filename: e ? c.blobName(e.id) : 'media.enc', content_type: 'application/octet-stream', size: e?.s ?? 0 }
}

/** Miniature JPEG embarquée dans le message (data:), si l'expéditeur en a fait une (web). */
export function thumbUri(e: c.FileEntry | null | undefined): string | undefined {
  if (!e?.th) return undefined
  const std = e.th.replace(/-/g, '+').replace(/_/g, '/')
  return `data:image/jpeg;base64,${std}${'='.repeat((4 - (std.length % 4)) % 4)}`
}

/** Déchiffrés d'office à l'affichage (images, sons, petites vidéos) ; au-delà, à la demande. */
export const AUTO_DECRYPT_MAX = 10 * 1024 * 1024

const opened = new Map<string, Promise<string>>()

const extOf = (name: string) => name.match(/\.([a-z0-9]{1,5})$/i)?.[1]?.toLowerCase() ?? 'bin'

/** Télécharge et déchiffre dans le cache ; rend l'adresse file:// du fichier en clair. Lève une erreur si altéré. */
export function decryptToCache(url: string, e: c.FileEntry): Promise<string> {
  let p = opened.get(e.id)
  if (!p) {
    p = fetchDecrypted(url, e)
    p.catch(() => opened.delete(e.id))
    opened.set(e.id, p)
  }
  return p
}

async function fetchDecrypted(url: string, e: c.FileEntry): Promise<string> {
  const src = resolveMediaUrl(url)
  if (!fs || !src) throw new Error('E2E_FILES_UNAVAILABLE')
  const blob = cacheFile(`${e.id}.dl`)
  const out = cacheFile(`${e.id}.${extOf(e.n)}`)
  safeDelete(blob)
  try {
    await fs.downloadFileAsync(src, blob, { idempotent: true })
    if (native?.decryptFile) await native.decryptFile(blob.uri, out.uri, b64Std(c.b64uDecode(e.k)), e.id, e.s)
    else await decryptJs(blob, out, c.b64uDecode(e.k), e.id, e.s)
    return out.uri
  } catch (err) {
    safeDelete(out)
    throw err
  } finally {
    safeDelete(blob)
  }
}

/**
 * Enregistre un fichier déchiffré dans un dossier choisi par l'utilisateur (sélecteur du
 * système) : une autre appli ne peut pas ouvrir le cache privé de ForgeChat. Rend faux si annulé.
 */
export async function saveToDevice(localUri: string, name: string, mime: string): Promise<boolean> {
  if (!fs?.pickDirectoryAsync) throw new Error('E2E_FILES_UNAVAILABLE')
  const dir = await fs.pickDirectoryAsync().catch(() => null)
  if (!dir) return false
  const input = new fs.FileSystemFile(localUri).open('r')
  const output = dir.createFile(name, mime).open('w')
  try {
    for (;;) {
      const b = input.readBytes(1024 * 1024)
      if (!b.length) return true
      output.writeBytes(b)
    }
  } finally {
    input.close()
    output.close()
  }
}
