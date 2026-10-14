// Épinglage des clés publiques (TOFU) : logique pure, testée par __tests__/key-pins.test.ts.
// Copie de client/src/e2e/keyPinsCore.ts (garder identiques). Voir docs/CHIFFREMENT-E2E.md §3 (empreintes).
// Le serveur fournit les clés publiques : on ne lui fait jamais confiance pour l'empreinte,
// on la recalcule (SHA-256 de la clé publique, base64url) et on la compare à celle épinglée.
import { b64uDecode, b64uEncode, fingerprint, verifyServerKeySig } from './crypto'

/** Empreinte épinglée d'un sujet (utilisateur, ou `server:<id>` pour une clé de récupération de serveur). */
export interface Pin { fp: string; verified?: boolean }
export type GetPin = (subject: string) => Promise<Pin | undefined>

/** Empreinte recalculée ici (jamais celle annoncée par le serveur). */
export async function fpOf(pub: string): Promise<string> {
  return b64uEncode(await fingerprint(b64uDecode(pub)))
}

export const serverSubject = (serverId: string) => `server:${serverId}`

interface Member { user_id: string; public: string | null }
export type Trusted<T> = T & { public: string; fingerprint: string }
export type Changed<T> = Trusted<T> & { verified: boolean }

/**
 * Trie des membres servis par le serveur :
 * - `trusted` : clé jamais vue (épinglée maintenant, `fresh`) ou identique à l'épinglée ;
 * - `changed` : clé différente de l'épinglée → on ne chiffre plus vers eux sans acceptation ;
 * - moi : seulement si la clé servie est bien la mienne (`myPub`), sinon exclu.
 * Le champ `fingerprint` rendu est TOUJOURS l'empreinte recalculée.
 */
export async function sortMembers<T extends Member>(list: T[], me: string, myPub: string | null, getPin: GetPin) {
  const trusted: Trusted<T>[] = []
  const changed: Changed<T>[] = []
  const fresh: { subject: string; fp: string }[] = []
  for (const m of list) {
    if (!m.public) continue
    let fp: string
    try { fp = await fpOf(m.public) } catch { continue } // clé mal formée : jamais de chiffrement vers elle
    const out = { ...m, public: m.public, fingerprint: fp }
    if (m.user_id === me) {
      if (myPub && m.public === myPub) trusted.push(out)
      continue
    }
    const pin = await getPin(m.user_id)
    if (!pin) { fresh.push({ subject: m.user_id, fp }); trusted.push(out) }
    else if (pin.fp === fp) trusted.push(out)
    else changed.push({ ...out, verified: !!pin.verified })
  }
  return { trusted, changed, fresh }
}

/**
 * Émetteur d'une enveloppe (`wrapped_by` / `wrapped_by_pub`, servis par le serveur) : moi avec MA clé,
 * ou un contact dont l'empreinte correspond à son épingle. Clé changée : refusée. Jamais vue : `fresh`
 * (TOFU, l'appelant épingle puis accepte). Sans cela un serveur compromis ferait adopter une clé qu'il connaît.
 */
export async function envelopeSender(
  by: string, byPub: string, me: string, myPub: string | null, getPin: GetPin,
): Promise<{ ok: boolean; fresh?: string }> {
  if (by === me) return { ok: !!myPub && byPub === myPub }
  let fp: string
  try { fp = await fpOf(byPub) } catch { return { ok: false } }
  const pin = await getPin(by)
  if (!pin) return { ok: true, fresh: fp }
  return { ok: pin.fp === fp }
}

/** Clé de récupération d'un serveur : `ok` si jamais vue (épinglée, `fresh`) ou identique. */
export async function checkServerKey(sk: { server_id: string; public: string }, getPin: GetPin) {
  const fp = await fpOf(sk.public)
  const pin = await getPin(serverSubject(sk.server_id))
  return { fp, ok: !pin || pin.fp === fp, fresh: !pin, verified: !!pin?.verified }
}

/**
 * Membres munis d'une clé exclus d'une nouvelle époque (clé changée non acceptée, clé mal formée) :
 * champ `withheld` de la création, que le serveur n'accepte que pour un changement de clé récent.
 */
export function withheldOf(all: Member[], trusted: { user_id: string }[], me: string): string[] {
  const ok = new Set(trusted.map(m => m.user_id))
  return all.filter(m => m.public && m.user_id !== me && !ok.has(m.user_id)).map(m => m.user_id)
}

/** Enveloppe d'époque illisible : vrai la première fois par (conversation, époque) dans `seen` (une session). */
export function firstUnreadable(seen: Set<string>, conv: string, epoch: number): boolean {
  const k = `${conv}|${epoch}`
  if (seen.has(k)) return false
  seen.add(k)
  return true
}

/** Clé de récupération telle que servie, avec la signature de son propriétaire (si elle existe). */
export interface SignedServerKey { server_id: string; public: string; signature?: string | null; signed_by?: string | null }

/**
 * Le propriétaire se porte garant de la clé : signature valide de moi-même, ou d'un signataire dont
 * la clé épinglée a été VÉRIFIÉE (codes de sécurité comparés en dehors de ForgeChat). Une simple
 * épingle ne suffit pas : elle vient souvent de la liste des membres, servie par le serveur, qui
 * pourrait inventer à la fois un faux propriétaire et une fausse clé signée par lui (constaté au
 * banc du 2026-10-12 : l'épinglage des membres précède l'enveloppe de l'époque). Sinon, acceptation explicite.
 * `signerPub` : clé publique servie pour le signataire (null si absente).
 */
export async function ownerVouches(
  sk: SignedServerKey, me: string, myPub: string | null, getPin: GetPin, signerPub: (id: string) => Promise<string | null>,
): Promise<boolean> {
  if (!sk.signature || !sk.signed_by) return false
  let pub: string | null
  if (sk.signed_by === me) {
    pub = myPub
  } else {
    const pin = await getPin(sk.signed_by)
    if (!pin?.verified) return false
    pub = await signerPub(sk.signed_by).catch(() => null)
    if (!pub) return false
    try { if ((await fpOf(pub)) !== pin.fp) return false } catch { return false }
  }
  if (!pub) return false
  return verifyServerKeySig(b64uDecode(pub), sk.signature, sk.server_id, sk.signed_by, sk.public)
}
