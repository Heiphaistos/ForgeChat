import { t } from '../i18n/index.ts'
// Clés d'accès (passkeys / WebAuthn) comme second facteur — audit 2026-10-12, amélioration n° 3.
// Le serveur (server/src/webauthn.rs) envoie ses options en base64url et vérifie origine, défi,
// signature et compteur. Web seulement : l'appli de bureau (origine tauri://) ne peut pas
// présenter une clé liée au domaine du site ; elle garde le code à 6 chiffres.

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export function passkeySupported(): boolean {
  return !isTauri && typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function' && !!navigator.credentials
}

export function b64uToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function bytesToB64u(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

type Json = Record<string, any>
const descriptors = (list: Json[] | undefined) =>
  (list ?? []).map(c => ({ type: 'public-key' as const, id: b64uToBytes(c.id) }))

/** Options serveur → options de `navigator.credentials.create`. */
export function creationOptions(o: Json): PublicKeyCredentialCreationOptions {
  return {
    challenge: b64uToBytes(o.challenge),
    rp: o.rp,
    user: { ...o.user, id: b64uToBytes(o.user.id) },
    pubKeyCredParams: o.pubKeyCredParams,
    authenticatorSelection: o.authenticatorSelection,
    excludeCredentials: descriptors(o.excludeCredentials),
    attestation: 'none',
    timeout: o.timeout,
  }
}

/** Options serveur → options de `navigator.credentials.get`. */
export function requestOptions(o: Json): PublicKeyCredentialRequestOptions {
  return {
    challenge: b64uToBytes(o.challenge),
    rpId: o.rpId,
    allowCredentials: descriptors(o.allowCredentials),
    userVerification: o.userVerification ?? 'preferred',
    timeout: o.timeout,
  }
}

export interface PasskeyAssertion { id: string; clientDataJSON: string; authenticatorData: string; signature: string }

/** Enregistre une clé sur cet appareil ; renvoie ce que le serveur vérifie. */
export async function createPasskey(serverOptions: Json): Promise<{ clientDataJSON: string; attestationObject: string }> {
  const cred = await navigator.credentials.create({ publicKey: creationOptions(serverOptions) }) as PublicKeyCredential | null
  if (!cred) throw new Error(t('sw.passkey.cancelled'))
  const r = cred.response as AuthenticatorAttestationResponse
  return { clientDataJSON: bytesToB64u(r.clientDataJSON), attestationObject: bytesToB64u(r.attestationObject) }
}

/** Signe le défi de connexion avec une clé du compte. */
export async function getPasskey(serverOptions: Json): Promise<PasskeyAssertion> {
  const cred = await navigator.credentials.get({ publicKey: requestOptions(serverOptions) }) as PublicKeyCredential | null
  if (!cred) throw new Error(t('sw.passkey.cancelled'))
  const r = cred.response as AuthenticatorAssertionResponse
  return {
    id: bytesToB64u(cred.rawId),
    clientDataJSON: bytesToB64u(r.clientDataJSON),
    authenticatorData: bytesToB64u(r.authenticatorData),
    signature: bytesToB64u(r.signature),
  }
}
