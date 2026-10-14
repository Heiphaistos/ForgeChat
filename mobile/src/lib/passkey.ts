import * as Passkeys from 'react-native-passkeys'
import { t } from '@/i18n'
import { logger } from './logger'

/**
 * Clés d'accès (WebAuthn) natives : même contrat serveur que le web (client/src/lib/passkey.ts,
 * server/src/handlers/passkeys.rs). Les options du serveur sont déjà en base64url JSON, le module
 * natif les attend ainsi et rend du base64url : ici seulement le tri des champs et la mise en forme
 * des réponses. Jamais de journal du contenu (défi, signatures).
 */

interface Descriptor { type: 'public-key'; id: string }
export interface ServerCreationOptions {
  challenge: string
  rp: { id: string; name: string }
  user: { id: string; name: string; displayName: string }
  pubKeyCredParams: { type: 'public-key'; alg: number }[]
  authenticatorSelection?: Record<string, unknown>
  excludeCredentials?: Descriptor[]
  timeout?: number
}
export interface ServerRequestOptions {
  challenge: string
  rpId: string
  allowCredentials?: Descriptor[]
  userVerification?: 'required' | 'preferred' | 'discouraged'
  timeout?: number
}
export interface PasskeyAttestation { clientDataJSON: string; attestationObject: string }
export interface PasskeyAssertion { id: string; clientDataJSON: string; authenticatorData: string; signature: string }

/** L'utilisateur a fermé la feuille système : pas une erreur à afficher. */
export class PasskeyCancelled extends Error {
  constructor() {
    super('passkey cancelled')
    this.name = 'PasskeyCancelled'
  }
}

/** base64 ou base64url (avec ou sans =) → base64url sans =, ce que le serveur décode. */
export const toB64u = (s: string): string => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const str = (v: unknown, what: string): string => {
  if (typeof v !== 'string' || !v) throw new Error(`passkey: ${what} manquant`)
  return v
}
const record = (v: unknown, what: string): Record<string, unknown> => {
  if (!v || typeof v !== 'object') throw new Error(`passkey: ${what} manquant`)
  return v as Record<string, unknown>
}

/** Options d'enregistrement du serveur → requête du module natif (attestation toujours « none »). */
export function creationRequest(o: unknown): Parameters<typeof Passkeys.create>[0] {
  const s = record(o, 'options') as unknown as ServerCreationOptions
  const user = record(s.user, 'user')
  const rp = record(s.rp, 'rp')
  return {
    challenge: str(s.challenge, 'défi'),
    rp: { id: str(rp.id, 'rp.id'), name: str(rp.name, 'rp.name') },
    user: { id: str(user.id, 'user.id'), name: str(user.name, 'user.name'), displayName: str(user.displayName ?? user.name, 'user.displayName') },
    pubKeyCredParams: Array.isArray(s.pubKeyCredParams) ? s.pubKeyCredParams : [],
    authenticatorSelection: s.authenticatorSelection as never,
    excludeCredentials: (s.excludeCredentials ?? []).map((c) => ({ type: 'public-key', id: str(c.id, 'id') })),
    attestation: 'none',
    timeout: s.timeout,
  }
}

/** Options de connexion du serveur → requête du module natif. */
export function requestRequest(o: unknown): Parameters<typeof Passkeys.get>[0] {
  const s = record(o, 'options') as unknown as ServerRequestOptions
  return {
    challenge: str(s.challenge, 'défi'),
    rpId: str(s.rpId, 'rpId'),
    allowCredentials: (s.allowCredentials ?? []).map((c) => ({ type: 'public-key', id: str(c.id, 'id') })),
    userVerification: s.userVerification ?? 'preferred',
    timeout: s.timeout,
  }
}

/** Corps de `register/finish` (hors `name`). */
export function attestationBody(r: { response?: { clientDataJSON?: string; attestationObject?: string } } | null): PasskeyAttestation {
  const resp = r?.response
  return { clientDataJSON: toB64u(str(resp?.clientDataJSON, 'clientDataJSON')), attestationObject: toB64u(str(resp?.attestationObject, 'attestationObject')) }
}

/** Champ `passkey` du corps de `/auth/login`. */
export function assertionBody(
  r: { id?: string; response?: { clientDataJSON?: string; authenticatorData?: string; signature?: string } } | null,
): PasskeyAssertion {
  const resp = r?.response
  return {
    id: toB64u(str(r?.id, 'id')),
    clientDataJSON: toB64u(str(resp?.clientDataJSON, 'clientDataJSON')),
    authenticatorData: toB64u(str(resp?.authenticatorData, 'authenticatorData')),
    signature: toB64u(str(resp?.signature, 'signature')),
  }
}

/** Annulation côté système : Android « UserCancelled », iOS « User cancelled the passkey interaction ». */
export function isCancel(e: unknown): boolean {
  return e instanceof PasskeyCancelled || (e instanceof Error && /cancel/i.test(`${e.name} ${e.message}`))
}

export function passkeySupported(): boolean {
  try {
    return Passkeys.isSupported()
  } catch {
    return false
  }
}

/** Erreur native (jamais le contenu de la requête) → annulation, ou message générique affichable. */
function fail(e: unknown): never {
  if (isCancel(e)) throw new PasskeyCancelled()
  logger.warn('passkey', 'cérémonie refusée', e instanceof Error ? e.message : 'inconnue')
  throw new Error(t('guard.passkey.failed'))
}

/** Crée une clé sur cet appareil (cérémonie système) ; renvoie ce que le serveur vérifie. */
export async function createPasskey(serverOptions: unknown): Promise<PasskeyAttestation> {
  try {
    const result = await Passkeys.create(creationRequest(serverOptions))
    if (!result) throw new PasskeyCancelled()
    return attestationBody(result as never)
  } catch (e) {
    return fail(e)
  }
}

/** Signe le défi de connexion avec une clé du compte. */
export async function getPasskey(serverOptions: unknown): Promise<PasskeyAssertion> {
  try {
    const result = await Passkeys.get(requestRequest(serverOptions))
    if (!result) throw new PasskeyCancelled()
    return assertionBody(result as never)
  } catch (e) {
    return fail(e)
  }
}
