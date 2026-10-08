// Parcours réel « cercle privé » contre un serveur ForgeChat LOCAL (Postgres et Redis jetables) :
// inscription sur invitation, panneau admin, bannissement, déconnexion forcée, journal.
// Usage : FORGECHAT_API_URL=http://127.0.0.1:58080 FORGECHAT_ADMIN_TOKEN=<jeton d'un admin> node scripts/admin.api.mjs
// Sans FORGECHAT_ADMIN_TOKEN, le script suppose une base VIDE : le premier compte devient admin.
const BASE = process.env.FORGECHAT_API_URL ?? 'http://127.0.0.1:58080'
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(BASE).hostname)) throw new Error('serveur local uniquement')

import { execSync } from 'node:child_process'

let failed = 0
const ok = (cond, label, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${cond || !extra ? '' : ` — ${extra}`}`)
  if (!cond) failed++
}
async function api(method, path, { token, body } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, body: json }
}
const PASSWORD = 'Mot de passe de test 42!'
const uniq = () => Math.random().toString(36).slice(2, 8)
// La limite d'inscriptions par IP (5 / 15 min) est testée ailleurs : on la remet à zéro (Redis local).
const resetRegisterLimit = () => { try { execSync("redis-cli --scan --pattern 'register_attempts:*' | xargs -r redis-cli del", { stdio: 'ignore' }) } catch { /* redis-cli absent */ } }
async function register(name, invite_code) {
  resetRegisterLimit()
  const user = { username: `${name}${uniq()}`, email: `${name}${uniq()}@test.local`, password: PASSWORD }
  const r = await api('POST', '/api/auth/register', { body: invite_code === undefined ? user : { ...user, invite_code } })
  return { ...user, status: r.status, error: r.body?.error, token: r.body?.access_token, refresh: r.body?.refresh_token, id: r.body?.user?.id }
}

// ── Administrateur
let adminToken = process.env.FORGECHAT_ADMIN_TOKEN
const info0 = (await api('GET', '/api/auth/registration-info')).body
if (!adminToken) {
  ok(info0.first_user === true && info0.mode === 'open', 'base vide : première inscription libre', JSON.stringify(info0))
  const first = await register('admin')
  ok(first.status === 200, 'premier compte créé sans code', first.error)
  adminToken = first.token
}
ok((await api('GET', '/api/admin/me', { token: adminToken })).status === 200, 'le premier compte est administrateur')

// ── Mode « invitation »
await api('PUT', '/api/admin/settings', { token: adminToken, body: { registration_mode: 'invite' } })
const info = (await api('GET', '/api/auth/registration-info')).body
ok(info.mode === 'invite' && info.first_user === false, 'mode invitation annoncé publiquement', JSON.stringify(info))

const noCode = await register('nocode')
ok(noCode.status === 403 && /invitation/i.test(noCode.error ?? ''), 'inscription sans code refusée', `${noCode.status} ${noCode.error}`)
const badCode = await register('badcode', 'ABCD-EFGH-JKMN')
ok(badCode.status === 403, 'code inconnu refusé', `${badCode.status}`)

const stranger = await register('stranger')
ok((await api('GET', '/api/admin/overview', { token: stranger.token })).status === 401 || stranger.status === 403, 'un inconnu n’a aucun accès admin')

const inv = await api('POST', '/api/admin/invites', { token: adminToken, body: { note: 'Cousine Léa', max_uses: 1, expires_in_days: 7 } })
ok(inv.status === 200 && /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(inv.body?.code ?? ''), 'code d’invitation généré (XXXX-XXXX-XXXX)', JSON.stringify(inv.body))
const code = inv.body.code

const nonAdmin = await register('lea', code.toLowerCase().replace(/-/g, ' '))
ok(nonAdmin.status === 200, 'inscription avec le code (saisie en minuscules, espaces tolérés)', `${nonAdmin.status} ${nonAdmin.error}`)
ok((await api('GET', '/api/admin/me', { token: nonAdmin.token })).status === 403, 'un membre ordinaire n’est pas admin')
ok((await api('GET', '/api/admin/users', { token: nonAdmin.token })).status === 403, 'liste des comptes réservée aux admins')

const reuse = await register('reuse', code)
ok(reuse.status === 403, 'code à usage unique : deuxième inscription refusée', `${reuse.status}`)

// Un pseudo déjà pris ne doit pas brûler le code
const inv2 = (await api('POST', '/api/admin/invites', { token: adminToken, body: { max_uses: 2 } })).body
resetRegisterLimit()
const dup = await api('POST', '/api/auth/register', { body: { username: nonAdmin.username, email: `dup${uniq()}@test.local`, password: PASSWORD, invite_code: inv2.code } })
ok(dup.status === 409, 'pseudo déjà pris → 409', `${dup.status}`)
const afterDup = (await api('GET', '/api/admin/invites', { token: adminToken })).body.invites.find(i => i.id === inv2.id)
ok(afterDup.uses === 0, 'le code n’est pas consommé par une inscription échouée', `uses=${afterDup.uses}`)

// Révocation
const inv3 = (await api('POST', '/api/admin/invites', { token: adminToken, body: {} })).body
ok((await api('DELETE', `/api/admin/invites/${inv3.id}`, { token: adminToken })).status === 204, 'invitation révoquée')
ok((await register('revoked', inv3.code)).status === 403, 'code révoqué refusé')

// ── Liste, aperçu
const ov = (await api('GET', '/api/admin/overview', { token: adminToken })).body
ok(ov.total_users >= 2 && typeof ov.online_now === 'number' && ov.registration_mode === 'invite', 'aperçu : nombre de comptes, connectés, mode', JSON.stringify(ov))
const list = (await api('GET', `/api/admin/users?q=${encodeURIComponent(nonAdmin.username)}`, { token: adminToken })).body
const row = list.users?.[0]
ok(list.total === 1 && row?.invited_by && row.email === nonAdmin.email.toLowerCase(), 'recherche d’un compte : e-mail et « invité par »', JSON.stringify(row))
const invs = (await api('GET', '/api/admin/invites', { token: adminToken })).body.invites
const used = invs.find(i => i.id === inv.body.id)
ok(used.status === 'used' && used.used_by?.[0]?.username === nonAdmin.username, 'invitation : statut « utilisée » et utilisateur lié', JSON.stringify(used))

// ── Bannissement
ok((await api('GET', '/api/users/me', { token: nonAdmin.token })).status === 200, 'avant bannissement : accès normal')
const adminSelf = (await api('GET', '/api/users/me', { token: adminToken })).body
ok((await api('POST', `/api/admin/users/${adminSelf.id}/ban`, { token: adminToken, body: {} })).status === 400, 'on ne peut pas se bannir soi-même')
ok((await api('POST', `/api/admin/users/${nonAdmin.id}/ban`, { token: adminToken, body: { reason: 'Test de bannissement' } })).status === 204, 'bannissement')
ok((await api('GET', '/api/users/me', { token: nonAdmin.token })).status === 401, 'jeton d’accès du banni refusé immédiatement')
const refreshBanned = await api('POST', '/api/auth/refresh', { body: { refresh_token: nonAdmin.refresh } })
ok(refreshBanned.status === 401, 'jeton de rafraîchissement du banni refusé', `${refreshBanned.status}`)
const loginBanned = await api('POST', '/api/auth/login', { body: { email: nonAdmin.email, password: PASSWORD } })
ok(loginBanned.status === 403 && /suspendu/.test(loginBanned.body?.error ?? '') && /Test de bannissement/.test(loginBanned.body?.error ?? ''), 'connexion du banni refusée avec le motif', JSON.stringify(loginBanned.body))
const bannedList = (await api('GET', '/api/admin/users?filter=banned', { token: adminToken })).body
ok(bannedList.users.some(u => u.id === nonAdmin.id && u.ban_reason === 'Test de bannissement'), 'filtre « bannis »')

ok((await api('DELETE', `/api/admin/users/${nonAdmin.id}/ban`, { token: adminToken })).status === 204, 'débannissement')
const loginAgain = await api('POST', '/api/auth/login', { body: { email: nonAdmin.email, password: PASSWORD } })
ok(loginAgain.status === 200, 'le compte débanni peut se reconnecter', `${loginAgain.status}`)

// ── Déconnexion forcée
const tok2 = loginAgain.body.access_token
ok((await api('POST', `/api/admin/users/${nonAdmin.id}/logout`, { token: adminToken })).status === 204, 'déconnexion forcée')
ok((await api('GET', '/api/users/me', { token: tok2 })).status === 401, 'jeton coupé après déconnexion forcée')

// ── Droits d'admin et réglages
ok((await api('PUT', `/api/admin/users/${nonAdmin.id}/admin`, { token: adminToken, body: { admin: true } })).status === 204, 'droits d’admin accordés')
const relog = await api('POST', '/api/auth/login', { body: { email: nonAdmin.email, password: PASSWORD } })
ok((await api('GET', '/api/admin/me', { token: relog.body.access_token })).status === 200, 'le nouvel admin accède au panneau')
ok((await api('POST', `/api/admin/users/${nonAdmin.id}/ban`, { token: adminToken, body: {} })).status === 403, 'un admin ne peut pas être banni sans retrait préalable')
await api('PUT', `/api/admin/users/${nonAdmin.id}/admin`, { token: adminToken, body: { admin: false } })

ok((await api('PUT', '/api/admin/settings', { token: adminToken, body: { registration_mode: 'closed' } })).status === 200, 'inscriptions fermées')
const closed = await register('closed', (await api('POST', '/api/admin/invites', { token: adminToken, body: {} })).body.code)
ok(closed.status === 403 && /fermées/.test(closed.error ?? ''), 'inscription fermée : même avec un code valide', `${closed.status} ${closed.error}`)
await api('PUT', '/api/admin/settings', { token: adminToken, body: { registration_mode: 'invite' } })
ok((await api('PUT', '/api/admin/settings', { token: adminToken, body: { registration_mode: 'nimporte' } })).status === 400, 'mode inconnu refusé')

const audit = (await api('GET', '/api/admin/audit', { token: adminToken })).body.entries.map(e => e.action)
ok(['ban', 'unban', 'force_logout', 'create_invite', 'revoke_invite', 'grant_admin', 'set_registration_mode'].every(a => audit.includes(a)), 'journal des actions complet', audit.join(','))

const detail = (await api('GET', `/api/admin/users/${nonAdmin.id}`, { token: adminToken })).body
ok(Array.isArray(detail.sessions) && Array.isArray(detail.servers) && Array.isArray(detail.invited), 'détail d’un compte (appareils, serveurs, invités)')

// ── Session : rotation du jeton tolérante (deux fenêtres, réponse perdue)
const sess = (await api('POST', '/api/auth/login', { body: { email: nonAdmin.email, password: PASSWORD } })).body
const r1 = await api('POST', '/api/auth/refresh', { body: { refresh_token: sess.refresh_token } })
ok(r1.status === 200 && r1.body.refresh_token && r1.body.refresh_token !== sess.refresh_token, 'rafraîchissement : nouveau jeton')
const r2 = await api('POST', '/api/auth/refresh', { body: { refresh_token: sess.refresh_token } })
ok(r2.status === 200 && r2.body.refresh_token !== r1.body.refresh_token, 'ancien jeton rejoué < 1 min (2e fenêtre) : accepté, nouveau jeton distinct', `${r2.status}`)
ok((await api('POST', '/api/auth/refresh', { body: { refresh_token: r1.body.refresh_token } })).status === 200, 'les deux chaînes de jetons restent valides')
ok((await api('POST', '/api/auth/refresh', { body: { refresh_token: 'inconnu' + uniq() } })).status === 401, 'jeton inconnu refusé')
await api('POST', '/api/auth/logout', { token: r2.body.access_token, body: {} })
ok((await api('POST', '/api/auth/refresh', { body: { refresh_token: sess.refresh_token } })).status === 401, 'après déconnexion, l’ancien jeton ne rouvre pas la session')

console.log(failed ? `\n${failed} échec(s).` : '\nTout est passé.')
process.exit(failed ? 1 : 0)
