// Connexion v2 pour les scripts *.api.mjs (docs/CHIFFREMENT-E2E.md §3) : le mot de passe ne part
// jamais, seul `auth` (authKdf.ts) est envoyé. Sans SMTP en test, le code de vérification d'e-mail
// est lu dans pending_registrations par psql (FORGECHAT_PSQL, base locale jetable).
// Chaque fonction prend l'`api(method, path, opts)` du script ; `opts` (ex. { ip }) est relayé.
import { execFileSync } from 'node:child_process'
import { deriveSecrets, newKdfSalt } from '../src/e2e/authKdf.ts'

export const PASSWORD = 'Mot de passe de test 42!'
const PSQL = process.env.FORGECHAT_PSQL ?? 'postgres://forgechat:ci@127.0.0.1:5432/forgechat'

// PBKDF2 à 600 000 tours : une dérivation par (mot de passe, sel), gardée pour les connexions suivantes.
const derived = new Map()
export function authFor(kdfSalt, password = PASSWORD) {
  const key = `${kdfSalt}|${password}`
  if (!derived.has(key)) derived.set(key, deriveSecrets(password, kdfSalt).then(s => s.auth))
  return derived.get(key)
}

/** Dernier code envoyé à l'inscription en attente de ce pseudo. */
export function pendingCode(username) {
  return execFileSync('psql', [PSQL, '-At', '-v', `u=${username}`], {
    input: "SELECT code FROM pending_registrations WHERE username = :'u' ORDER BY created_at DESC LIMIT 1",
    encoding: 'utf8',
  }).trim()
}

/** Inscription + vérification d'e-mail. Rend la réponse de verify-email (jetons), ou celle de register si elle refuse. */
export async function register(api, { username, email, password = PASSWORD, invite_code }, opts = {}) {
  const kdf_salt = newKdfSalt()
  const body = { username, email, auth: await authFor(kdf_salt, password), kdf_salt }
  if (invite_code !== undefined) body.invite_code = invite_code
  const reg = await api('POST', '/api/auth/register', { ...opts, body })
  if (reg.status !== 200 || reg.body?.pending !== true) return reg
  const code = pendingCode(username)
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
