// Fichiers et pièces jointes chiffrés de bout en bout côté web (docs/CHIFFREMENT-E2E.md §12).
// Envoi : chaque fichier est chiffré par morceaux sur l'appareil, le serveur ne reçoit
// qu'un blob opaque `<id>.enc` ; clé, nom, type, taille, dimensions et miniature vont
// dans le contenu chiffré du message (`f: [...]`). Réception : téléchargement du blob,
// déchiffrement en flux, affichage par une adresse blob: (jamais de copie en clair ailleurs).
import { mediaUrl } from '../api/client'
import { signUpload } from '../lib/useSignedUrl'
import { saveFile } from '../lib/saveFile'
import { postWithUploadProgress } from '../utils/uploadProgress'
import { mustEncrypt, type ConvKind } from './conversations'
import * as c from './crypto'

/** Fichier choisi par l'utilisateur (avec sa durée de vie éventuelle). */
export interface PendingUpload { file: File; ttlHours?: number | null }

/** Fichiers prêts à l'envoi : `entries` (à mettre dans le contenu chiffré) seulement s'ils sont chiffrés. */
export interface PreparedFiles { entries?: c.FileEntry[]; form: FormData; bytes: number; count: number }

const THUMB_SIDE = 96

const toB64u = (b: ArrayBuffer) => c.b64uEncode(new Uint8Array(b))

/** Miniature JPEG d'une image ou d'une image de vidéo, assez petite pour le message. */
async function thumbnail(src: CanvasImageSource, w: number, h: number): Promise<string | undefined> {
  if (!w || !h) return undefined
  const scale = Math.min(1, THUMB_SIDE / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * scale))
  canvas.height = Math.max(1, Math.round(h * scale))
  canvas.getContext('2d')?.drawImage(src, 0, 0, canvas.width, canvas.height)
  for (const q of [0.6, 0.35]) {
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', q))
    const th = blob ? toB64u(await blob.arrayBuffer()) : ''
    if (th && th.length <= c.MAX_THUMB_B64) return th
  }
  return undefined
}

/** Durée, dimensions et image d'une vidéo ou d'un son (au plus 4 s, sinon sans). */
function mediaInfo(file: File, video: boolean): Promise<Partial<c.FileEntry>> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const el = document.createElement(video ? 'video' : 'audio')
    const done = (info: Partial<c.FileEntry>) => { clearTimeout(timer); URL.revokeObjectURL(url); el.removeAttribute('src'); resolve(info) }
    const timer = setTimeout(() => done({}), 4000)
    const base = () => ({ ...(Number.isFinite(el.duration) ? { d: Math.round(el.duration) } : {}) })
    el.preload = 'metadata'
    el.muted = true
    el.onerror = () => done({})
    el.onloadedmetadata = () => {
      if (!(el instanceof HTMLVideoElement)) return done(base())
      el.currentTime = Math.min(0.5, (el.duration || 1) / 2)
    }
    if (el instanceof HTMLVideoElement) {
      el.onseeked = () => {
        void thumbnail(el, el.videoWidth, el.videoHeight)
          .then(th => done({ ...base(), w: el.videoWidth, h: el.videoHeight, ...(th ? { th } : {}) }), () => done(base()))
      }
    }
    el.src = url
  })
}

async function fileMeta(file: File): Promise<Partial<c.FileEntry>> {
  try {
    if (file.type.startsWith('image/') && file.type !== 'image/svg+xml') {
      const bmp = await createImageBitmap(file)
      const th = await thumbnail(bmp, bmp.width, bmp.height)
      const out = { w: bmp.width, h: bmp.height, ...(th ? { th } : {}) }
      bmp.close()
      return out
    }
    if (file.type.startsWith('video/')) return await mediaInfo(file, true)
    if (file.type.startsWith('audio/')) return await mediaInfo(file, false)
  } catch { /* format illisible par le navigateur : sans aperçu */ }
  return {}
}

/** Chiffre un fichier morceau par morceau (le fichier n'est jamais lu en entier d'un coup). */
export async function sealFile(file: File): Promise<{ entry: c.FileEntry; blob: Blob }> {
  const id = crypto.randomUUID()
  const key = c.randomBytes(32)
  const cipher = await c.fileCipher(key)
  const parts: BlobPart[] = []
  for (let i = 0, off = 0; ; i++, off += c.FILE_CHUNK) {
    const last = off + c.FILE_CHUNK >= file.size
    const plain = new Uint8Array(await file.slice(off, off + c.FILE_CHUNK).arrayBuffer())
    parts.push((await cipher.encrypt(id, i, last, plain)) as Uint8Array<ArrayBuffer>)
    if (last) break
  }
  const entry: c.FileEntry = {
    id, k: c.b64uEncode(key), n: file.name || 'fichier', m: file.type || 'application/octet-stream', s: file.size,
    ...(await fileMeta(file)),
  }
  return { entry, blob: new Blob(parts, { type: 'application/octet-stream' }) }
}

/**
 * Prépare les fichiers d'un envoi : chiffrés si la conversation l'exige (les
 * entrées vont alors dans le contenu chiffré du message), sinon en clair
 * (transition : membre sans clé, salon d'un auteur sans clé).
 */
export async function prepareFiles(kind: ConvKind, id: string, files: PendingUpload[]): Promise<PreparedFiles> {
  const form = new FormData()
  let bytes = 0
  if (!files.length) return { form, bytes, count: 0 }
  const encrypt = await mustEncrypt(kind, id)
  const entries: c.FileEntry[] = []
  for (const { file, ttlHours } of files) {
    if (encrypt) {
      const sealed = await sealFile(file)
      entries.push(sealed.entry)
      form.append('files', sealed.blob, c.blobName(sealed.entry.id))
      bytes += sealed.blob.size
    } else {
      form.append('files', file)
      bytes += file.size
    }
    if (ttlHours != null) form.append('ttl_hours', String(ttlHours))
  }
  return { ...(encrypt ? { entries } : {}), form, bytes, count: files.length }
}

/** Envoie les fichiers préparés vers la route d'un message (rien s'il n'y en a pas). */
export async function uploadPrepared(url: string, p: PreparedFiles | null | undefined) {
  if (p?.count) await postWithUploadProgress(url, p.form, p.bytes)
}

/** Contenu chiffré additionnel d'un envoi avec fichiers. */
export const filesExtra = (p: PreparedFiles | null | undefined): Record<string, unknown> | undefined =>
  p?.entries?.length ? { f: p.entries } : undefined

// ─── Affichage ──────────────────────────────────────────────────────────────
/** Pièce jointe telle que renvoyée par le serveur. */
export interface ServerAttachment { id: string; url: string; filename: string; content_type: string; size: number; expires_at?: string | null }
/** Pièce jointe à afficher : `e2e` = fichier chiffré et sa clé ; `e2eLocked` = blob chiffré sans clé (message illisible). */
export type DisplayAttachment<A extends ServerAttachment = ServerAttachment> = A & { e2e?: c.FileEntry; e2eLocked?: boolean }

const isBlob = (a: ServerAttachment) => a.content_type === 'application/octet-stream' && /\.enc$/.test(a.filename)

/** Relie les blobs chiffrés du serveur aux fichiers décrits dans le contenu déchiffré du message. */
export function displayAttachments<A extends ServerAttachment>(atts: A[] | null | undefined, body: unknown): DisplayAttachment<A>[] {
  const entries = new Map(c.fileEntries(body).map(e => [c.blobName(e.id), e]))
  return (atts ?? []).map(a => {
    const e = isBlob(a) ? entries.get(a.filename) : undefined
    if (e) return { ...a, filename: e.n, content_type: e.m, size: e.s, e2e: e }
    return isBlob(a) ? { ...a, e2eLocked: true } : a
  })
}

/** Miniature embarquée dans le message (data: JPEG). */
export function thumbUrl(e: c.FileEntry): string | undefined {
  if (!e.th) return undefined
  const std = e.th.replace(/-/g, '+').replace(/_/g, '/')
  return `data:image/jpeg;base64,${std}${'='.repeat((4 - (std.length % 4)) % 4)}`
}

/** Fichiers déchiffrés automatiquement à l'affichage (images, sons, petites vidéos). */
export const AUTO_DECRYPT_MAX = 20 * 1024 * 1024

// ponytail: adresses blob: gardées pour la session (pas d'éviction) ; seuls les petits fichiers
// sont déchiffrés d'office, les gros à la demande. Ajouter une éviction LRU si la mémoire gonfle.
const decrypted = new Map<string, Promise<string>>()
const blobs = new Map<string, Promise<Blob>>()

/** Fichier déchiffré (une seule fois par session), pour qui doit lire ses octets (src/ai). */
export function decryptedBlob(url: string, e: c.FileEntry): Promise<Blob> {
  let p = blobs.get(e.id)
  if (!p) {
    p = fetchDecrypted(url, e)
    p.catch(() => blobs.delete(e.id))
    blobs.set(e.id, p)
  }
  return p
}

/** Télécharge et déchiffre en flux ; rend une adresse blob: au type sûr. Lève une erreur si altéré. */
export function decryptedUrl(url: string, e: c.FileEntry): Promise<string> {
  let p = decrypted.get(e.id)
  if (!p) {
    p = decryptedBlob(url, e).then(blob => URL.createObjectURL(blob))
    p.catch(() => decrypted.delete(e.id))
    decrypted.set(e.id, p)
  }
  return p
}

async function fetchDecrypted(url: string, e: c.FileEntry): Promise<Blob> {
  // Adresse signée (?exp&sig) : déjà signée par l'API, ou brute tirée d'un contenu chiffré (forum). Pas de cookie.
  const res = await fetch(mediaUrl(await signUpload(url))!)
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
  const dec = new c.FileDecryptor(await c.fileCipher(c.b64uDecode(e.k)), e.id, e.s)
  const parts: BlobPart[] = []
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    for (const p of await dec.push(value)) parts.push(p as Uint8Array<ArrayBuffer>)
  }
  parts.push((await dec.end()) as Uint8Array<ArrayBuffer>)
  return new Blob(parts, { type: c.safeMime(e.m) })
}

/** Enregistre le fichier déchiffré sur l'appareil sous son vrai nom. */
export async function saveDecrypted(url: string, e: c.FileEntry) {
  await saveFile(await decryptedBlob(url, e), e.n)
}
