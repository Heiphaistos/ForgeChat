// Anti-retour arrière de la connexion v2 (audit 2026-10-10, docs/CHIFFREMENT-E2E.md §3.1).
// Même logique que client/src/e2e/authGuard.ts : un serveur modifié peut répondre
// `legacy: true` au prelogin d'un compte déjà migré pour recevoir le mot de passe en clair.
// L'appareil retient dans SecureStore les comptes vus migrés (SHA-256 de l'e-mail normalisé,
// jamais l'e-mail) et refuse alors d'envoyer le mot de passe. Non effacé à la déconnexion.
import { sha256 } from '@noble/hashes/sha2.js'
import { secureStateStorage } from '@/lib/secureStorage'

export function accountTag(email: string): string {
  const h = sha256(new TextEncoder().encode(`forgechat v2 account|${email.trim().toLowerCase()}`))
  return Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('')
}

const key = (email: string) => `fc_v2_account_${accountTag(email)}`

/** Lève `AUTH_DOWNGRADE` si le serveur demande le mot de passe en clair pour un compte connu migré. */
export async function guardPrelogin(email: string, info: { legacy: boolean }) {
  if (info.legacy && (await secureStateStorage.getItem(key(email))) === '1') throw new Error('AUTH_DOWNGRADE')
}

/** Après une connexion v2 réussie (ou la migration du compte). */
export const markMigrated = async (email: string) => { await secureStateStorage.setItem(key(email), '1') }

// Même principe par identifiant de compte, pour les actions sensibles (connecté : `GET /users/me/kdf`).
const userKey = (userId: string) => `fc_v2_account_${accountTag(`user|${userId}`)}`

/** Après une connexion v2 (ou la création d'un compte v2). */
export const markUserMigrated = async (userId: string) => { await secureStateStorage.setItem(userKey(userId), '1') }

/** Avant une preuve de mot de passe : mémorise l'état migré, lève `AUTH_DOWNGRADE` sur un retour arrière. */
export async function guardKdf(userId: string, info: { legacy: boolean }) {
  if (!info.legacy) return markUserMigrated(userId)
  if ((await secureStateStorage.getItem(userKey(userId))) === '1') throw new Error('AUTH_DOWNGRADE')
}
