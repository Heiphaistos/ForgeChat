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
