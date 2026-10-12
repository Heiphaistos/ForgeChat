// Journal de transparence des clés (audit 2026-10-12, amélioration n° 10) — vérification sur
// l'appareil. Le serveur (server/src/key_log.rs) chaîne chaque clé publiée :
//   hash = SHA-256("fc-kt-v1|seq|user_tag|key_hash|prev_hash"), user_tag = SHA-256("fc-kt-user|<id>").
// L'appareil vérifie :
// 1. que la chaîne déjà vue n'a jamais été réécrite (reprise depuis la tête mémorisée) ;
// 2. que la dernière clé inscrite pour SON compte est bien la sienne (sinon : un tiers a publié une
//    clé à son nom) ;
// 3. que la clé servie pour un contact figure au journal (`kt_seq`).
// Même fichier que le web (client/src/e2e/keyTransparency.ts), SHA-256 de noble (pas de WebCrypto
// sous React Native). Testé par __tests__/key-transparency.test.ts (vecteur partagé avec le serveur).
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

export const GENESIS = '0'.repeat(64)

export interface KtEntry { seq: number; user_tag: string; key_hash: string; prev_hash: string; hash: string }
export interface KtHead { seq: number; hash: string }

async function sha256hex(text: string): Promise<string> {
  return bytesToHex(sha256(utf8ToBytes(text)))
}

export const userTag = (userId: string) => sha256hex(`fc-kt-user|${userId}`)
export const keyHash = (publicB64u: string) => sha256hex(publicB64u)
export const entryHash = (seq: number, tag: string, kh: string, prev: string) => sha256hex(`fc-kt-v1|${seq}|${tag}|${kh}|${prev}`)

export type ChainCheck = { ok: true; head: KtHead | null } | { ok: false; seq: number; reason: string }

/** Vérifie que `entries` prolongent exactement `from` (null : depuis le début). */
export async function verifyRange(entries: readonly KtEntry[], from: KtHead | null): Promise<ChainCheck> {
  let seq = from?.seq ?? 0
  let prev = from?.hash ?? GENESIS
  for (const e of entries) {
    if (e.seq !== seq + 1) return { ok: false, seq: e.seq, reason: 'numérotation' }
    if (e.prev_hash !== prev) return { ok: false, seq: e.seq, reason: 'chaînage' }
    if (await entryHash(e.seq, e.user_tag, e.key_hash, e.prev_hash) !== e.hash) return { ok: false, seq: e.seq, reason: 'empreinte' }
    seq = e.seq
    prev = e.hash
  }
  return { ok: true, head: seq ? { seq, hash: prev } : from }
}

export interface MonitorState { head: KtHead | null; ownLatest: string | null }
export type MonitorResult =
  | { status: 'ok'; state: MonitorState }
  | { status: 'rewritten'; seq: number; reason: string }
  | { status: 'foreign_key'; seq: number }

export type PageFetcher = (after: number) => Promise<{ entries: KtEntry[]; head: KtHead | null }>

/**
 * Reprend le journal depuis `state`, vérifie la chaîne et la dernière clé inscrite pour ce compte.
 * `myPub` : clé publique de compte de cet appareil.
 */
export async function monitor(state: MonitorState | null, myUserId: string, myPub: string, fetchPage: PageFetcher): Promise<MonitorResult> {
  const tag = await userTag(myUserId)
  const mine = await keyHash(myPub)
  let head = state?.head ?? null
  let ownLatest = state?.ownLatest ?? null
  let ownSeq = 0
  for (let guard = 0; guard < 10_000; guard++) {
    const page = await fetchPage(head?.seq ?? 0)
    if (!page.entries.length) {
      // Le serveur annonce une tête que la chaîne vérifiée ne rejoint pas : historique réécrit.
      if (page.head && head && (page.head.seq < head.seq || (page.head.seq === head.seq && page.head.hash !== head.hash))) {
        return { status: 'rewritten', seq: page.head.seq, reason: 'tête' }
      }
      break
    }
    const check = await verifyRange(page.entries, head)
    if (!check.ok) return { status: 'rewritten', seq: check.seq, reason: check.reason }
    for (const e of page.entries) if (e.user_tag === tag) { ownLatest = e.key_hash; ownSeq = e.seq }
    head = check.head
  }
  if (ownLatest && ownLatest !== mine) return { status: 'foreign_key', seq: ownSeq }
  return { status: 'ok', state: { head, ownLatest } }
}

/** La clé servie pour un contact est-elle celle inscrite à `ktSeq` ? */
export async function contactKeyLogged(userId: string, pub: string, entry: KtEntry | null): Promise<boolean> {
  if (!entry) return false
  return entry.user_tag === await userTag(userId) && entry.key_hash === await keyHash(pub)
}
