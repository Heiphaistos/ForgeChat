#!/usr/bin/env node
// Suppression de compte, contre un serveur ForgeChat LOCAL uniquement.
// Usage : node mobile/scripts/e2e-delete-account.mjs   (ou npm run e2e:delete dans mobile/)
//
// X écrit partout (salon, DM, groupe dont il est propriétaire, réactions, épinglés, invitation, fil,
// forum, avatar, clé publique, appareil push, amitiés, blocage), puis supprime son compte.
// Attendu : succès, contenus partagés conservés sous « Utilisateur supprimé », données personnelles
// effacées, avatar retiré du disque, propriété du groupe transférée. Sans dépendance (Node >= 22).
import { execFileSync } from 'node:child_process'

const BASE = process.env.FORGECHAT_API_URL || 'http://localhost:8080'
const POSTGRES_CONTAINER = process.env.POSTGRES_CONTAINER || 'forgechat-mobile-postgres-1'
const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
if (!LOCAL.has(new URL(BASE).hostname)) {
  console.error(`Refus : e2e-delete-account.mjs ne s'exécute que contre localhost (cible : ${BASE}).`)
  process.exit(1)
}
const DELETED = 'Utilisateur supprimé'

let passed = 0
const failures = []
const check = (ok, label, detail = '') => {
  if (ok) {
    passed++
    console.log(`  ✓ ${label}`)
  } else {
    failures.push(label)
    console.log(`  ✗ ${label} ${detail}`)
  }
}
const rand = () => Math.random().toString(36).slice(2, 8)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(method, path, { token, body, form } = {}) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  let payload
  if (form) payload = form
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }
  return { status: res.status, body: json, text }
}
const must = (res, label) => {
  if (res.status < 200 || res.status >= 300) {
    console.error(`Préparation impossible (${label}) : ${res.status} ${JSON.stringify(res.body)}`)
    process.exit(2)
  }
  return res.body
}
const sql = (q) => execFileSync('docker', ['exec', POSTGRES_CONTAINER, 'psql', '-U', 'forgechat', '-d', 'forgechat', '-Atc', q], { encoding: 'utf8' }).trim()
const file = (field, name, type, bytes) => {
  const f = new FormData()
  f.append(field, new Blob([bytes], { type }), name)
  return f
}
// PNG 1×1 valide.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

async function user(tag) {
  const s = rand()
  const u = { username: `del${tag}${s}`, email: `del_${tag}_${s}@test.local`, password: `Del-${s}-Passw0rd` }
  const r = must(await api('POST', '/api/auth/register', { body: u }), `inscription ${tag}`)
  await sleep(1100)
  const l = must(await api('POST', '/api/auth/login', { body: { email: u.email, password: u.password } }), `connexion ${tag}`)
  await sleep(1100)
  return { ...u, id: r.user.id, token: l.access_token }
}

async function main() {
  console.log(`== Suppression de compte (${BASE}) ==\n-- Préparation --`)
  const Y = await user('y')
  const Z = await user('z')
  const W = await user('w')
  const X = await user('x')
  const marker = `del-marqueur-${rand()}`
  const tx = { token: X.token }

  // Amitiés X–Y, X–Z ; X bloque W.
  for (const F of [Y, Z]) {
    must(await api('POST', '/api/friends/by-name', { token: X.token, body: { name: F.username } }), 'demande d’ami')
    const p = must(await api('GET', '/api/friends/v2?filter=pending_received', { token: F.token }), 'demandes reçues')
    must(await api('POST', `/api/friends/${p.friends.find((f) => f.friend_id === X.id).id}/accept`, { token: F.token }), 'acceptation')
  }
  must(await api('POST', `/api/friends/block/${W.id}`, tx), 'blocage')

  // Profil : avatar, clé publique, appareil push.
  const avatar = must(await api('POST', '/api/users/me/avatar', { ...tx, form: file('avatar', 'a.png', 'image/png', PNG) }), 'avatar').avatar
  must(await api('POST', '/api/users/me/pubkey', { ...tx, body: { pub_key: `cle-${rand()}` } }), 'clé publique')
  must(await api('POST', '/api/push/devices', { ...tx, body: { token: `ExponentPushToken[del${rand()}]`, platform: 'android' } }), 'appareil push')

  // Serveur de Y : salon texte + forum ; X y écrit, réagit, crée une invitation, un fil, un post.
  const srv = must(await api('POST', '/api/servers', { token: Y.token, body: { name: `Serveur del ${rand()}` } }), 'serveur')
  const inv = must(await api('POST', `/api/servers/${srv.id}/invites`, { token: Y.token, body: { max_age: 3600 } }), 'invitation Y')
  must(await api('POST', `/api/servers/join/${inv.code}`, tx), 'X rejoint')
  const ch = must(await api('POST', `/api/servers/${srv.id}/channels`, { token: Y.token, body: { name: 'general-del', type: 'text' } }), 'salon')
  const forum = must(await api('POST', `/api/servers/${srv.id}/channels`, { token: Y.token, body: { name: 'forum-del', type: 'forum' } }), 'forum')
  const cBase = `/api/servers/${srv.id}/channels/${ch.id}`
  const fBase = `/api/servers/${srv.id}/channels/${forum.id}`
  const e = encodeURIComponent('👍')
  const cMsg = must(await api('POST', `${cBase}/messages`, { ...tx, body: { content: `salon ${marker}` } }), 'message salon')
  must(await api('PUT', `${cBase}/messages/${cMsg.id}/reactions/${e}`, tx), 'réaction salon')
  must(await api('POST', `${cBase}/messages/${cMsg.id}/pin`, { token: Y.token }), 'épingle salon (par Y)')
  // Créer une invitation exige MANAGE_SERVER : rôle dédié pour X.
  const mod = must(await api('POST', `/api/servers/${srv.id}/roles`, { token: Y.token, body: { name: 'invitations', permissions: 256 } }), 'rôle')
  must(await api('PUT', `/api/servers/${srv.id}/members/${X.id}/roles/${mod.role?.id ?? mod.id}`, { token: Y.token }), 'rôle attribué à X')
  const xInv = must(await api('POST', `/api/servers/${srv.id}/invites`, { ...tx, body: { max_age: 3600 } }), 'invitation X')
  const thread = must(await api('POST', `${cBase}/threads`, { ...tx, body: { title: 'fil del', first_message: `fil ${marker}` } }), 'fil')
  const post = must(await api('POST', `${fBase}/posts`, { ...tx, body: { title: 'post del', content: `forum ${marker}` } }), 'post forum')
  const postId = post.id ?? post.post?.id
  must(await api('POST', `${fBase}/posts/${postId}/replies`, { ...tx, body: { content: `réponse ${marker}` } }), 'réponse forum')

  // DM X–Y : message, pièce jointe, épingle, réaction.
  const dmId = must(await api('POST', `/api/dms/${Y.id}`, tx), 'DM').dm_id
  const dmMsg = must(await api('POST', `/api/dms/${dmId}/messages`, { ...tx, body: { content: `dm ${marker}`, has_attachments: true } }), 'message DM')
  must(await api('POST', `/api/dms/${dmId}/messages/${dmMsg.id}/attachments`, { ...tx, form: file('file', 'dm.txt', 'text/plain', Buffer.from('pj')) }), 'pièce jointe DM')
  must(await api('POST', `/api/dms/${dmId}/pins/${dmMsg.id}`, tx), 'épingle DM')
  must(await api('PUT', `/api/dms/${dmId}/messages/${dmMsg.id}/reactions/${e}`, tx), 'réaction DM')

  // Groupe X (propriétaire), Y, Z : message et épingle.
  const grp = must(await api('POST', '/api/dms/group', { ...tx, body: { name: 'Groupe del', user_ids: [Y.id, Z.id] } }), 'groupe')
  const gMsg = must(await api('POST', `/api/dms/groups/${grp.id}/messages`, { ...tx, body: { content: `groupe ${marker}` } }), 'message groupe')
  must(await api('PUT', `/api/dms/groups/${grp.id}/messages/${gMsg.id}/pin`, tx), 'épingle groupe')

  console.log('\n-- Suppression --')
  const del = await api('DELETE', '/api/users/me', { ...tx, body: { password: X.password } })
  check(del.status === 200, 'la suppression réussit', `(statut ${del.status} ${del.text})`)
  if (del.status !== 200) return

  console.log('\n-- Données personnelles effacées --')
  check(sql(`SELECT COUNT(*) FROM users WHERE id='${X.id}'`) === '0', 'profil supprimé')
  for (const [table, col] of [
    ['user_sessions', 'user_id'],
    ['refresh_tokens', 'user_id'],
    ['push_devices', 'user_id'],
    ['user_pubkeys', 'user_id'],
    ['friendships', 'user_id'],
    ['friendships', 'friend_id'],
    ['blocks', 'blocker_id'],
    ['reactions', 'user_id'],
    ['dm_reactions', 'user_id'],
    ['group_dm_members', 'user_id'],
    ['server_members', 'user_id'],
  ]) {
    check(sql(`SELECT COUNT(*) FROM ${table} WHERE ${col}='${X.id}'`) === '0', `${table}.${col} vidé`)
  }
  const av = await fetch(`${BASE}${avatar}`)
  check(av.status === 404, 'fichier d’avatar retiré du disque', `(statut ${av.status})`)
  const relog = await api('POST', '/api/auth/login', { body: { email: X.email, password: X.password } })
  check(relog.status === 401, 'connexion impossible', `(statut ${relog.status})`)

  console.log('\n-- Contenus conservés, visibles par les autres sous « Utilisateur supprimé » --')
  const T = { token: Y.token }
  const seen = (res, what) => {
    const ok = res.status === 200 && res.text.includes(marker) && res.text.includes(DELETED) && !res.text.includes(X.username)
    check(ok, what, `(statut ${res.status})`)
  }
  seen(await api('GET', `${cBase}/messages`, T), 'message de salon')
  seen(await api('GET', `${cBase}/threads/${thread.id ?? thread.thread?.id}/messages`, T), 'fil')
  seen(await api('GET', `${fBase}/posts/${postId}`, T), 'post et réponse de forum')
  seen(await api('GET', `/api/dms/${dmId}/messages`, T), 'message de DM')
  seen(await api('GET', `/api/dms/groups/${grp.id}/messages`, { token: Z.token }), 'message de groupe (vu par Z)')
  const dms = must(await api('GET', '/api/dms', T), 'DM de Y')
  check(JSON.stringify(dms).includes(DELETED), 'le DM apparaît avec « Utilisateur supprimé » dans la liste de Y')
  // Y et Z sont ajoutés par la même requête (même joined_at) : l'un ou l'autre est « le plus ancien ».
  check([Y.id, Z.id].includes(sql(`SELECT owner_id FROM group_dm_channels WHERE id='${grp.id}'`)), 'propriété du groupe transférée à un membre restant')
  check(sql(`SELECT COUNT(*) FROM invites WHERE code='${xInv.code}' AND creator_id IS NULL`) === '1', 'invitation conservée, créateur effacé')
  const pins = await api('GET', `${cBase}/pins`, T)
  check(pins.status === 200 && pins.text.includes(marker), 'épingle du salon conservée')
  const write = await api('POST', `/api/dms/${dmId}/messages`, { ...T, body: { content: 'encore là ?' } })
  check(write.status === 400, 'écrire au compte supprimé est refusé', `(statut ${write.status})`)
  const dmNew = await api('POST', `/api/dms/00000000-0000-0000-0000-00000000dead`, T)
  check(dmNew.status === 404, 'ouvrir un DM avec « Utilisateur supprimé » est refusé', `(statut ${dmNew.status})`)
}

main()
  .then(() => {
    console.log(`\n=== Résultat : ${passed} OK, ${failures.length} échec(s) ===`)
    process.exit(failures.length ? 1 : 0)
  })
  .catch((e) => {
    console.error(e)
    process.exit(2)
  })
