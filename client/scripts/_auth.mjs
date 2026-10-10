// Connexion v2 pour les scripts *.api.mjs (docs/CHIFFREMENT-E2E.md §3) : le mot de passe ne part
// jamais, seul `auth` (authKdf.ts) est envoyé. Le code de vérification d'e-mail est lu dans la boîte
// de test du serveur (FORGECHAT_TEST_MAILBOX : un fichier JSON {to, subject, body} par e-mail ; la base
// n'en garde qu'une empreinte). Chaque fonction prend l'`api(method, path, opts)` du script ; `opts`
// (ex. { ip }) est relayé.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deriveSecrets, newKdfSalt } from '../src/e2e/authKdf.ts'

export const PASSWORD = 'Mot de passe de test 42!'
const MAILBOX = process.env.FORGECHAT_TEST_MAILBOX

// PBKDF2 à 600 000 tours : une dérivation par (mot de passe, sel), gardée pour les connexions suivantes.
const derived = new Map()
export function authFor(kdfSalt, password = PASSWORD) {
  const key = `${kdfSalt}|${password}`
  if (!derived.has(key)) derived.set(key, deriveSecrets(password, kdfSalt).then(s => s.auth))
  return derived.get(key)
}

// Dossier absent tant que le serveur n'a écrit aucun e-mail : vide, pas une erreur.
const mails = () => existsSync(MAILBOX) ? readdirSync(MAILBOX).filter(f => f.endsWith('.json')) : []

/** Code du premier e-mail arrivé pour `email` hors de `seen` (envoi en tâche de fond : 10 s au plus). */
async function mailedCode(email, seen) {
  const to = email.trim().toLowerCase()
  for (let i = 0; i < 200; i++) {
    for (const f of mails().filter(f => !seen.has(f)).sort()) {
      const mail = JSON.parse(readFileSync(join(MAILBOX, f), 'utf8'))
      const code = mail.to === to && /color:#fff">(\d{6})</.exec(mail.body)?.[1]
      if (code) return code
    }
    await new Promise(r => setTimeout(r, 50))
  }
  throw new Error(`aucun code reçu pour ${to} dans ${MAILBOX}`)
}

/** Inscription + vérification d'e-mail. Rend la réponse de verify-email (jetons), ou celle de register si elle refuse. */
export async function register(api, { username, email, password = PASSWORD, invite_code }, opts = {}) {
  const kdf_salt = newKdfSalt()
  const body = { username, email, auth: await authFor(kdf_salt, password), kdf_salt }
  if (invite_code !== undefined) body.invite_code = invite_code
  if (!MAILBOX) throw new Error('FORGECHAT_TEST_MAILBOX manquante (dossier où le serveur de test écrit ses e-mails)')
  const seen = new Set(mails())
  const reg = await api('POST', '/api/auth/register', { ...opts, body })
  if (reg.status !== 200 || reg.body?.pending !== true) return reg
  const code = await mailedCode(email, seen)
  return api('POST', '/api/auth/verify-email', { ...opts, body: { email, code } })
}

/** prelogin puis login. */
export async function login(api, email, { password = PASSWORD, totp_code } = {}, opts = {}) {
  const pre = await api('POST', '/api/auth/prelogin', { ...opts, body: { email } })
  const auth = await authFor(pre.body.kdf_salt, password)
  return api('POST', '/api/auth/login', { ...opts, body: { email, auth, totp_code } })
}

/** Preuve du mot de passe du compte connecté, pour une action sensible ({auth}). */
export async function proofFor(api, token, password = PASSWORD) {
  const { kdf_salt } = (await api('GET', '/api/users/me/kdf', { token })).body
  return authFor(kdf_salt, password)
}
