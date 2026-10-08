// Parcours réel « cercle privé » contre un serveur ForgeChat LOCAL (Postgres et Redis jetables) :
// inscription sur invitation, panneau admin, bannissement, déconnexion forcée, journal.
// Usage : FORGECHAT_API_URL=http://127.0.0.1:58080 FORGECHAT_ADMIN_TOKEN=<jeton d'un admin> node scripts/admin.api.mjs
// Sans FORGECHAT_ADMIN_TOKEN, le script suppose une base VIDE et crée le compte administrateur
// (e-mail FORGECHAT_ADMIN_EMAIL, heiphaistos44@gmail.com par défaut) : lui seul a accès à l'administration.
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
const REDIS_DB = process.env.FORGECHAT_REDIS_DB ?? '0'
const resetRegisterLimit = () => { try { execSync(`redis-cli -n ${REDIS_DB} --scan --pattern 'register_attempts:*' | xargs -r redis-cli -n ${REDIS_DB} del`, { stdio: 'ignore' }) } catch { /* redis-cli absent */ } }
const ADMIN_EMAIL = (process.env.FORGECHAT_ADMIN_EMAIL ?? 'heiphaistos44@gmail.com').toLowerCase()
async function register(name, invite_code, email) {
  resetRegisterLimit()
  const user = { username: `${name}${uniq()}`, email: email ?? `${name}${uniq()}@test.local`, password: PASSWORD }
  const r = await api('POST', '/api/auth/register', { body: invite_code === undefined ? user : { ...user, invite_code } })
  return { ...user, status: r.status, error: r.body?.error, token: r.body?.access_token, refresh: r.body?.refresh_token, id: r.body?.user?.id }
}

// ── Administrateur
let adminToken = process.env.FORGECHAT_ADMIN_TOKEN
const info0 = (await api('GET', '/api/auth/registration-info')).body
if (!adminToken) {
  ok(info0.first_user === true && info0.mode === 'open', 'base vide : première inscription libre', JSON.stringify(info0))
  const first = await register('admin', undefined, ADMIN_EMAIL)
  ok(first.status === 200, 'premier compte créé sans code', first.error)
  adminToken = first.token
}
ok((await api('GET', '/api/admin/me', { token: adminToken })).status === 200, 'le compte de l’e-mail administrateur a accès à l’administration')

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

// ── Rôle « El Patron » : seul le propriétaire l'attribue
const asLea = async () => (await api('POST', '/api/auth/login', { body: { email: nonAdmin.email, password: PASSWORD } })).body.access_token
let leaTok = await asLea()
ok((await api('GET', '/api/admin/me', { token: leaTok })).status === 403, 'sans le rôle, aucun accès à l’administration')
ok((await api('GET', '/api/admin/audit', { token: leaTok })).status === 403, 'journal admin refusé sans le rôle')
ok((await api('GET', '/api/admin/diagnostics', { token: leaTok })).status === 403, 'rapports d’erreurs refusés sans le rôle')
ok((await api('GET', '/api/admin/dm-reports', { token: leaTok })).status === 403, 'signalements refusés sans le rôle')
ok((await api('PUT', `/api/admin/users/${nonAdmin.id}/patron`, { token: leaTok, body: { patron: true } })).status === 403, 'on ne peut pas se donner le rôle soi-même')
const meOwner = (await api('GET', '/api/admin/me', { token: adminToken })).body
ok(meOwner.owner === true, 'le propriétaire est reconnu comme tel')
ok((await api('PUT', `/api/admin/users/${nonAdmin.id}/patron`, { token: adminToken, body: { patron: true } })).status === 204, 'le propriétaire donne le rôle El Patron')
const meLea = await api('GET', '/api/admin/me', { token: leaTok })
ok(meLea.status === 200 && meLea.body.owner === false, 'le El Patron accède à l’administration (sans être propriétaire)', JSON.stringify(meLea.body))
ok((await api('GET', '/api/admin/users', { token: leaTok })).status === 200, 'le El Patron liste les comptes')
const owner = (await api('GET', '/api/admin/users?filter=patrons', { token: adminToken })).body.users
const ownerId = owner.find(u => u.is_owner)?.id
ok(!!ownerId && owner.some(u => u.id === nonAdmin.id && u.is_patron && !u.is_owner), 'filtre « El Patron » : propriétaire et El Patron listés')
const other = await register('autre', (await api('POST', '/api/admin/invites', { token: adminToken, body: {} })).body.code)
ok((await api('PUT', `/api/admin/users/${other.id}/patron`, { token: leaTok, body: { patron: true } })).status === 403, 'un El Patron ne peut pas en nommer un autre')
ok((await api('POST', `/api/admin/users/${ownerId}/ban`, { token: leaTok, body: {} })).status === 403, 'un El Patron ne peut pas bannir le propriétaire')
ok((await api('POST', `/api/admin/users/${nonAdmin.id}/ban`, { token: adminToken, body: {} })).status === 403, 'un El Patron ne se bannit pas sans retrait préalable du rôle')
ok((await api('PUT', `/api/admin/users/${ownerId}/patron`, { token: adminToken, body: { patron: false } })).status === 400, 'le rôle du propriétaire ne se retire pas')
// ── Pleins pouvoirs : intouchables et tout-puissants sur un serveur de tiers dont ils ne sont que membres
const invite = async () => (await api('POST', '/api/admin/invites', { token: adminToken, body: {} })).body.code
const host = await register('hote', await invite())
const plain = await register('simple', await invite())
const srv = (await api('POST', '/api/servers', { token: host.token, body: { name: 'Jotunheim test' } })).body
ok(!!srv?.id && !!srv.invite_code, 'serveur d’un tiers créé', JSON.stringify(srv))
for (const tok of [adminToken, leaTok, plain.token]) await api('POST', `/api/servers/join/${srv.invite_code}`, { token: tok })
const S = `/api/servers/${srv.id}`
for (const [label, id] of [['propriétaire du site', ownerId], ['El Patron', nonAdmin.id]]) {
  ok((await api('POST', `${S}/members/${id}/kick`, { token: host.token })).status === 403, `${label} : impossible à expulser`)
  ok((await api('POST', `${S}/members/${id}/ban`, { token: host.token, body: {} })).status === 403, `${label} : impossible à bannir du serveur`)
  ok((await api('POST', `${S}/members/${id}/timeout`, { token: host.token, body: { duration_minutes: 10 } })).status === 403, `${label} : impossible à mettre en timeout`)
  ok((await api('PATCH', `${S}/members/${id}/voice`, { token: host.token, body: { mute: true } })).status === 403, `${label} : impossible à rendre muet`)
  ok((await api('PATCH', `${S}/members/${id}/voice`, { token: host.token, body: { deafen: true } })).status === 403, `${label} : impossible à rendre sourd`)
}
ok((await api('PATCH', S, { token: leaTok, body: { name: 'Renommé par El Patron' } })).status === 200, 'El Patron (simple membre) renomme le serveur d’un tiers')
ok((await api('POST', `${S}/members/${plain.id}/kick`, { token: adminToken })).status === 200, 'le propriétaire du site (simple membre) expulse un membre')
ok((await api('POST', `${S}/members/${host.id}/timeout`, { token: leaTok, body: { duration_minutes: 5 } })).status === 200, 'El Patron peut mettre en timeout même le propriétaire du serveur')
ok((await api('DELETE', `${S}/members/${host.id}/timeout`, { token: leaTok })).status === 200, '… et lever le timeout')

ok((await api('PUT', `/api/admin/users/${nonAdmin.id}/patron`, { token: adminToken, body: { patron: false } })).status === 204, 'le propriétaire retire le rôle')
ok((await api('GET', '/api/admin/me', { token: leaTok })).status === 403, 'rôle retiré : accès coupé aussitôt')
ok((await api('POST', `${S}/members/${nonAdmin.id}/kick`, { token: host.token })).status === 200, 'rôle retiré : le compte redevient un simple membre (expulsable)')
ok((await api('GET', '/api/admin/diagnostics', { token: leaTok })).status === 403, 'rôle retiré : rapports d’erreurs refusés')

ok((await api('PUT', '/api/admin/settings', { token: adminToken, body: { registration_mode: 'closed' } })).status === 200, 'inscriptions fermées')
const closed = await register('closed', (await api('POST', '/api/admin/invites', { token: adminToken, body: {} })).body.code)
ok(closed.status === 403 && /fermées/.test(closed.error ?? ''), 'inscription fermée : même avec un code valide', `${closed.status} ${closed.error}`)
await api('PUT', '/api/admin/settings', { token: adminToken, body: { registration_mode: 'invite' } })
ok((await api('PUT', '/api/admin/settings', { token: adminToken, body: { registration_mode: 'nimporte' } })).status === 400, 'mode inconnu refusé')

const audit = (await api('GET', '/api/admin/audit', { token: adminToken })).body.entries.map(e => e.action)
ok(['ban', 'unban', 'force_logout', 'create_invite', 'revoke_invite', 'set_registration_mode', 'grant_patron', 'revoke_patron'].every(a => audit.includes(a)), 'journal des actions complet', audit.join(','))

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
