#!/usr/bin/env node
// Contrôles d'accès de l'API, contre un serveur ForgeChat LOCAL uniquement.
// Usage : node mobile/scripts/e2e-authz.mjs   (ou npm run e2e:authz dans mobile/)
//
// A et B partagent un DM, un groupe (avec D, le serveur exigeant 2 autres membres) et un salon.
// C, étranger à tout cela, tente chaque action : toute réussite est une faille (sortie ≠ 0).
// Sans dépendance : fetch/FormData/Blob natifs Node >= 22.
import { execFileSync } from 'node:child_process'

const BASE = process.env.FORGECHAT_API_URL || 'http://localhost:8080'
const POSTGRES_CONTAINER = process.env.POSTGRES_CONTAINER || 'forgechat-mobile-postgres-1'
// Garde stricte : jamais contre un autre hôte que cette machine (pas d'option pour la contourner).
const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
if (!LOCAL.has(new URL(BASE).hostname)) {
  console.error(`Refus : e2e-authz.mjs ne s'exécute que contre localhost (cible : ${BASE}).`)
  process.exit(1)
}

let passed = 0
const failures = []
const check = (blocked, label, res) => {
  if (blocked) {
    passed++
    console.log(`  ✓ ${label}`)
  } else {
    failures.push(label)
    console.log(`  ✗ FAILLE : ${label} — statut ${res?.status}`)
  }
}
/** Attendu : refusé (tout sauf 2xx). */
const denied = (res, label) => check(!(res.status >= 200 && res.status < 300), label, res)
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
  return { status: res.status, body: json }
}
const must = (res, label) => {
  if (res.status < 200 || res.status >= 300) {
    console.error(`Préparation impossible (${label}) : ${res.status} ${JSON.stringify(res.body)}`)
    process.exit(2)
  }
  return res.body
}
const sql = (q) => execFileSync('docker', ['exec', POSTGRES_CONTAINER, 'psql', '-U', 'forgechat', '-d', 'forgechat', '-Atc', q], { encoding: 'utf8' }).trim()
const textFile = (name) => {
  const f = new FormData()
  f.append('file', new Blob([Buffer.from('secret de A et B')], { type: 'text/plain' }), name)
  return f
}

async function user(tag) {
  const s = rand()
  const u = { username: `authz${tag}${s}`, email: `authz_${tag}_${s}@test.local`, password: `Authz-${s}-Passw0rd` }
  const r = must(await api('POST', '/api/auth/register', { body: u }), `inscription ${tag}`)
  await sleep(1100) // jetons sans jti : éviter deux émissions dans la même seconde
  // Connexion explicite : l'inscription ne crée pas de ligne user_sessions (constat serveur),
  // or on a besoin d'une vraie session pour tester sa révocation par un tiers.
  const l = must(await api('POST', '/api/auth/login', { body: { email: u.email, password: u.password } }), `connexion ${tag}`)
  await sleep(1100)
  return { ...u, id: r.user.id, token: l.access_token }
}

async function main() {
  console.log(`== Contrôles d'accès (${BASE}) ==\n-- Préparation --`)
  const A = await user('a')
  const B = await user('b')
  const D = await user('d')
  const C = await user('c')
  const marker = `authz-marqueur-${rand()}`

  // Amitiés A–B et A–D (DM et groupe exigent des amis).
  for (const X of [B, D]) {
    must(await api('POST', '/api/friends/by-name', { token: A.token, body: { name: X.username } }), 'demande d’ami')
    const p = must(await api('GET', '/api/friends/v2?filter=pending_received', { token: X.token }), 'demandes reçues')
    const req = p.friends.find((f) => f.friend_id === A.id)
    must(await api('POST', `/api/friends/${req.id}/accept`, { token: X.token }), 'acceptation')
  }

  // DM A–B, avec message, pièce jointe, épinglé, réaction.
  const dmId = must(await api('POST', `/api/dms/${B.id}`, { token: A.token }), 'ouverture DM').dm_id
  const dmMsg = must(await api('POST', `/api/dms/${dmId}/messages`, { token: A.token, body: { content: `DM ${marker}`, has_attachments: true } }), 'message DM')
  const dmAtt = must(await api('POST', `/api/dms/${dmId}/messages/${dmMsg.id}/attachments`, { token: A.token, form: textFile('dm.txt') }), 'pièce jointe DM')
  must(await api('POST', `/api/dms/${dmId}/pins/${dmMsg.id}`, { token: A.token }), 'épingle DM')

  // Groupe A, B, D.
  const grp = must(await api('POST', '/api/dms/group', { token: A.token, body: { name: 'Groupe authz', user_ids: [B.id, D.id] } }), 'groupe')
  const gMsg = must(await api('POST', `/api/dms/groups/${grp.id}/messages`, { token: A.token, body: { content: `Groupe ${marker}`, has_attachments: true } }), 'message groupe')
  const gAtt = must(await api('POST', `/api/dms/groups/${grp.id}/messages/${gMsg.id}/attachments`, { token: A.token, form: textFile('groupe.txt') }), 'pièce jointe groupe')

  // Serveur de A, rejoint par B ; salon texte.
  const srv = must(await api('POST', '/api/servers', { token: A.token, body: { name: `Serveur authz ${rand()}` } }), 'serveur')
  const inv = must(await api('POST', `/api/servers/${srv.id}/invites`, { token: A.token, body: { max_age: 3600 } }), 'invitation')
  must(await api('POST', `/api/servers/join/${inv.code}`, { token: B.token }), 'B rejoint')
  const ch = must(await api('POST', `/api/servers/${srv.id}/channels`, { token: A.token, body: { name: 'prive-authz', type: 'text' } }), 'salon')
  const cBase = `/api/servers/${srv.id}/channels/${ch.id}`
  const cMsg = must(await api('POST', `${cBase}/messages`, { token: A.token, body: { content: `Salon ${marker}`, has_attachments: true } }), 'message salon')
  const cAtt = must(await api('POST', `${cBase}/messages/${cMsg.id}/attachments`, { token: A.token, form: textFile('salon.txt') }), 'pièce jointe salon')

  // Session et appareil push de A.
  const aSession = must(await api('GET', '/api/users/me/sessions', { token: A.token }), 'sessions A')
  const pushToken = `ExponentPushToken[authz${rand()}]`
  must(await api('POST', '/api/push/devices', { token: A.token, body: { token: pushToken, platform: 'android' } }), 'push A')

  const e = encodeURIComponent('👍')
  const T = { token: C.token }

  console.log('\n-- C contre le DM de A et B --')
  denied(await api('GET', `/api/dms/${dmId}/messages`, T), 'lire les messages du DM')
  denied(await api('GET', `/api/dms/${dmId}/messages/search?q=${marker}`, T), 'chercher dans le DM')
  denied(await api('POST', `/api/dms/${dmId}/messages`, { ...T, body: { content: 'intrus' } }), 'écrire dans le DM')
  denied(await api('PATCH', `/api/dms/${dmId}/messages/${dmMsg.id}`, { ...T, body: { content: 'modifié' } }), 'modifier un message du DM')
  denied(await api('DELETE', `/api/dms/${dmId}/messages/${dmMsg.id}`, T), 'supprimer un message du DM')
  denied(await api('PUT', `/api/dms/${dmId}/messages/${dmMsg.id}/reactions/${e}`, T), 'réagir dans le DM')
  denied(await api('GET', `/api/dms/${dmId}/pins`, T), 'lire les épinglés du DM')
  denied(await api('POST', `/api/dms/${dmId}/pins/${dmMsg.id}`, T), 'épingler dans le DM')
  denied(await api('DELETE', `/api/dms/${dmId}/pins/${dmMsg.id}`, T), 'désépingler dans le DM')
  denied(await api('POST', `/api/dms/${dmId}/messages/${dmMsg.id}/attachments`, { ...T, form: textFile('intrus.txt') }), 'téléverser dans le DM')
  denied(await api('PATCH', `/api/dms/${dmId}/settings`, { ...T, body: { muted: true } }), 'régler le DM')
  denied(await api('GET', `/api/dms/${dmId}/read`, T), 'lire l’état de lecture du DM')
  denied(await api('GET', `/api/dms/${dmId}/e2e`, T), 'lire le canal chiffré du DM')

  console.log('\n-- C contre le groupe de A, B, D --')
  const G = `/api/dms/groups/${grp.id}`
  denied(await api('GET', G, T), 'lire le groupe')
  denied(await api('GET', `${G}/messages`, T), 'lire les messages du groupe')
  denied(await api('GET', `${G}/messages/search?q=${marker}`, T), 'chercher dans le groupe')
  denied(await api('POST', `${G}/messages`, { ...T, body: { content: 'intrus' } }), 'écrire dans le groupe')
  denied(await api('PATCH', `${G}/messages/${gMsg.id}`, { ...T, body: { content: 'modifié' } }), 'modifier un message du groupe')
  denied(await api('DELETE', `${G}/messages/${gMsg.id}`, T), 'supprimer un message du groupe')
  denied(await api('PUT', `${G}/messages/${gMsg.id}/reactions/${e}`, T), 'réagir dans le groupe')
  denied(await api('PUT', `${G}/messages/${gMsg.id}/pin`, T), 'épingler dans le groupe')
  denied(await api('GET', `${G}/pins`, T), 'lire les épinglés du groupe')
  denied(await api('POST', `${G}/messages/${gMsg.id}/attachments`, { ...T, form: textFile('intrus.txt') }), 'téléverser dans le groupe')
  denied(await api('POST', `${G}/members`, { ...T, body: { user_id: C.id } }), 's’ajouter au groupe')
  denied(await api('PATCH', `${G}/rename`, { ...T, body: { name: 'pris' } }), 'renommer le groupe')
  denied(await api('DELETE', `${G}/members/${B.id}`, T), 'retirer un membre du groupe')

  console.log('\n-- C contre le salon du serveur de A (C n’est pas membre) --')
  denied(await api('GET', `/api/servers/${srv.id}`, T), 'lire le serveur')
  denied(await api('GET', `/api/servers/${srv.id}/channels`, T), 'lister les salons')
  denied(await api('GET', `/api/servers/${srv.id}/members`, T), 'lister les membres')
  denied(await api('GET', `${cBase}/messages`, T), 'lire les messages du salon')
  denied(await api('GET', `${cBase}/messages/search?q=${marker}`, T), 'chercher dans le salon')
  denied(await api('POST', `${cBase}/messages`, { ...T, body: { content: 'intrus' } }), 'écrire dans le salon')
  denied(await api('PATCH', `${cBase}/messages/${cMsg.id}`, { ...T, body: { content: 'modifié' } }), 'modifier un message du salon')
  denied(await api('DELETE', `${cBase}/messages/${cMsg.id}`, T), 'supprimer un message du salon')
  denied(await api('PUT', `${cBase}/messages/${cMsg.id}/reactions/${e}`, T), 'réagir dans le salon')
  denied(await api('POST', `${cBase}/messages/${cMsg.id}/pin`, T), 'épingler dans le salon')
  denied(await api('GET', `${cBase}/pins`, T), 'lire les épinglés du salon')
  denied(await api('POST', `${cBase}/messages/${cMsg.id}/attachments`, { ...T, form: textFile('intrus.txt') }), 'téléverser dans le salon')

  console.log('\n-- C et la recherche globale --')
  const s = await api('GET', `/api/search?q=${marker}`, T)
  check(s.status === 200 && (s.body?.messages ?? []).length === 0, 'la recherche globale ne renvoie aucun message de A/B', s)

  console.log('\n-- C et les pièces jointes de A/B (URL connue) --')
  for (const [label, att] of [['DM', dmAtt], ['groupe', gAtt], ['salon', cAtt]]) {
    const url = (Array.isArray(att) ? att[0] : att)?.url
    const withToken = await fetch(`${BASE}${url}`, { headers: { Authorization: `Bearer ${C.token}` } })
    const anonymous = await fetch(`${BASE}${url}`)
    check(withToken.status >= 400, `lire la pièce jointe du ${label} avec le compte de C`, withToken)
    check(anonymous.status >= 400, `lire la pièce jointe du ${label} sans être connecté`, anonymous)
  }

  console.log('\n-- C contre la session et l’appareil push de A --')
  const aSessionId = aSession[0]?.id
  if (!aSessionId) throw new Error('A n’a aucune session listée : test de révocation impossible')
  await api('DELETE', `/api/users/me/sessions/${aSessionId}`, T)
  const still = await api('GET', '/api/users/me/sessions', { token: A.token })
  check((still.body ?? []).some((x) => x.id === aSessionId), 'révoquer la session de A (elle doit subsister)', still)
  await api('DELETE', `/api/push/devices/${encodeURIComponent(pushToken)}`, T)
  const n = sql(`SELECT count(*) FROM push_devices WHERE token='${pushToken.replace(/'/g, "''")}' AND user_id='${A.id}'`)
  check(n === '1', 'supprimer l’appareil push de A (il doit subsister)', { status: `lignes=${n}` })
  const cSessions = await api('GET', '/api/users/me/sessions', T)
  check(!(cSessions.body ?? []).some((x) => x.id === aSessionId), 'voir la session de A dans ses propres sessions', cSessions)

  console.log(`\n=== Résultat : ${passed} accès refusés comme attendu, ${failures.length} faille(s) ===`)
  if (failures.length) {
    for (const f of failures) console.log(`  - ${f}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(2)
})
