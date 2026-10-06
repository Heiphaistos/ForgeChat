#!/usr/bin/env node
// Contrôles d'accès de l'API, contre un serveur ForgeChat LOCAL uniquement.
// Usage : node mobile/scripts/e2e-authz.mjs   (ou npm run e2e:authz dans mobile/)
//
// A et B partagent un DM, un groupe (avec D, le serveur exigeant 2 autres membres) et un salon.
// C, étranger à tout cela, tente chaque action : toute réussite est une faille (sortie ≠ 0).
// Sans dépendance : fetch/FormData/Blob natifs Node >= 22.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

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

async function api(method, path, { token, body, form, headers: extra } = {}) {
  const headers = { ...extra }
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

let registrations = 0
async function user(tag) {
  const s = rand()
  const u = { username: `authz${tag}${s}`, email: `authz_${tag}_${s}@test.local`, password: `Authz-${s}-Passw0rd` }
  // Une IP de test par inscription : le script dépasse la limite d'inscriptions par IP.
  const headers = { 'X-Forwarded-For': `198.51.100.${100 + ++registrations}` }
  const r = must(await api('POST', '/api/auth/register', { body: u, headers }), `inscription ${tag}`)
  await sleep(1100) // jetons sans jti : éviter deux émissions dans la même seconde
  // Connexion explicite : session distincte de celle de l'inscription, révoquée plus loin par un tiers.
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

  console.log('\n-- Groupes : amis acceptés uniquement --')
  {
    denied(await api('POST', '/api/dms/group', { ...T, body: { user_ids: [A.id, B.id] } }), 'C crée un groupe avec des non-amis')
    denied(await api('POST', `/api/dms/groups/${grp.id}/members`, { token: A.token, body: { user_id: C.id } }), 'A ajoute C (pas son ami) au groupe')
    denied(await api('POST', `/api/dms/groups/${grp.id}/members`, { token: B.token, body: { user_id: C.id } }), 'B (membre) ajoute C (pas son ami) au groupe')
    const dup = await api('POST', '/api/dms/group', { token: A.token, body: { user_ids: [B.id, B.id, A.id] } })
    check(dup.status === 400, 'créer un « groupe » à 2 avec des doublons et soi-même', dup)
    const ghost = await api('POST', `/api/dms/groups/${grp.id}/members`, { token: A.token, body: { user_id: '00000000-0000-4000-8000-000000000000' } })
    check(ghost.status === 400, 'ajouter un utilisateur inexistant (400, pas 500)', ghost)
    const g = must(await api('GET', `/api/dms/groups/${grp.id}`, { token: A.token }), 'détails du groupe')
    check(g.members.length === 3, 'le groupe a toujours 3 membres', { status: g.members.length })
  }

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

  console.log('\n-- Les membres reçoivent des URL signées utilisables --')
  must(await api('POST', '/api/saved', { token: A.token, body: { message_id: cMsg.id, channel_id: ch.id, server_id: srv.id } }), 'enregistrer le message du salon')
  const lists = [
    ['DM', `/api/dms/${dmId}/messages?limit=50`, (b) => b],
    ['groupe', `/api/dms/groups/${grp.id}/messages?limit=50`, (b) => b],
    ['salon', `${cBase}/messages?limit=50`, (b) => b],
    ['enregistrés', '/api/saved', (b) => b],
  ]
  for (const [label, path, pick] of lists) {
    const res = must(await api('GET', path, { token: A.token }), `liste ${label}`)
    const items = pick(Array.isArray(res) ? res : (res.messages ?? res.items ?? []))
    const url = items.flatMap((m) => m.attachments ?? []).map((a) => a.url).find(Boolean) ?? ''
    const r = url ? await fetch(`${BASE}${url}`) : { status: 0 }
    if (!url.includes('sig=') || r.status !== 200) throw new Error(`liste ${label} : URL de pièce jointe non signée ou illisible (${r.status})`)
    console.log(`  ✓ liste ${label} : URL signée lisible par le membre`)
  }

  console.log('\n-- C et les pièces jointes de A/B (URL connue) --')
  for (const [label, att] of [['DM', dmAtt], ['groupe', gAtt], ['salon', cAtt]]) {
    const signed = (Array.isArray(att) ? att[0] : att)?.url ?? ''
    // Contrôle positif : l'URL signée renvoyée au membre fonctionne (sinon le test lui-même est faux).
    const own = await fetch(`${BASE}${signed}`)
    if (!signed.includes('sig=') || own.status !== 200) throw new Error(`URL signée de la pièce jointe du ${label} inutilisable (${own.status})`)
    const bare = signed.split('?')[0]
    const withToken = await fetch(`${BASE}${bare}`, { headers: { Authorization: `Bearer ${C.token}` } })
    const anonymous = await fetch(`${BASE}${bare}`)
    const forged = await fetch(`${BASE}${signed.replace(/sig=./, (m) => (m.endsWith('A') ? 'sig=B' : 'sig=A'))}`)
    check(withToken.status >= 400, `lire la pièce jointe du ${label} avec le compte de C`, withToken)
    check(anonymous.status >= 400, `lire la pièce jointe du ${label} sans être connecté`, anonymous)
    check(forged.status >= 400, `lire la pièce jointe du ${label} avec une signature falsifiée`, forged)
  }

  console.log('\n-- B (membre du serveur) contre un salon privé de A --')
  // Salon masqué à @everyone par une surcharge ; B est membre du serveur mais n'y a pas accès.
  const roles = must(await api('GET', `/api/servers/${srv.id}/roles`, { token: A.token }), 'rôles')
  const everyone = roles.find((r) => r.is_everyone)
  const priv = must(await api('POST', `/api/servers/${srv.id}/channels`, { token: A.token, body: { name: 'secret-authz', type: 'text' } }), 'salon privé')
  must(await api('PUT', `/api/channels/${priv.id}/permissions/${everyone.id}`, { token: A.token, body: { target_type: 'role', allow: 0, deny: 1 } }), 'surcharge @everyone')
  const pBase = `/api/servers/${srv.id}/channels/${priv.id}`
  const secret = `secret-${marker}`
  const pMsg = must(await api('POST', `${pBase}/messages`, { token: A.token, body: { content: `${secret} <@${B.id}> @${B.username}` } }), 'message privé')
  must(await api('PUT', `${pBase}/messages/${pMsg.id}/reactions/${e}`, { token: A.token }), 'réaction privée')
  must(await api('POST', `${pBase}/messages/${pMsg.id}/pin`, { token: A.token }), 'épingle privée')
  must(await api('GET', `${pBase}/messages`, { token: A.token }), 'le propriétaire lit le salon privé')

  // B écoute le temps réel pendant que A écrit dans le salon privé puis dans le salon ouvert.
  const ticket = must(await api('POST', '/api/auth/ws-ticket', { token: B.token, body: {} }), 'ticket WS').ticket
  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws?ticket=${encodeURIComponent(ticket)}`)
  const received = []
  ws.onmessage = (ev) => received.push(String(ev.data))
  await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = ko })
  await sleep(800)
  must(await api('POST', `${pBase}/messages`, { token: A.token, body: { content: `${secret} en direct` } }), 'message privé en direct')
  must(await api('POST', `${cBase}/messages`, { token: A.token, body: { content: `ouvert ${marker} en direct` } }), 'message ouvert en direct')
  await sleep(1500)
  ws.close()
  if (!received.some((m) => m.includes(`ouvert ${marker} en direct`))) throw new Error('B n’a pas reçu le message du salon ouvert : test temps réel inopérant')
  check(!received.some((m) => m.includes(secret) || m.includes(priv.id)), 'recevoir en temps réel un événement du salon privé', { status: 'reçu' })

  const TB = { token: B.token }
  const listed = must(await api('GET', `/api/servers/${srv.id}/channels`, TB), 'salons de B')
  check(!listed.some((c) => c.id === priv.id), 'voir le salon privé dans la liste des salons', { status: 'listé' })
  const detail = must(await api('GET', `/api/servers/${srv.id}`, TB), 'serveur vu par B')
  check(!(detail.channels ?? []).some((c) => c.id === priv.id), 'voir le salon privé dans le détail du serveur', { status: 'listé' })
  denied(await api('GET', `${pBase}/messages`, TB), 'lire les messages du salon privé')
  denied(await api('GET', `${pBase}/messages/search?q=${secret}`, TB), 'chercher dans le salon privé')
  denied(await api('POST', `${pBase}/messages`, { ...TB, body: { content: 'intrus' } }), 'écrire dans le salon privé')
  denied(await api('GET', `${pBase}/pins`, TB), 'lire les épinglés du salon privé')
  denied(await api('PUT', `${pBase}/messages/${pMsg.id}/reactions/${e}`, TB), 'réagir dans le salon privé')
  denied(await api('POST', `${pBase}/messages/${pMsg.id}/pin`, TB), 'épingler dans le salon privé')
  denied(await api('GET', `${pBase}/threads`, TB), 'lister les fils du salon privé')
  denied(await api('POST', `${pBase}/messages/${pMsg.id}/attachments`, { ...TB, form: textFile('intrus.txt') }), 'téléverser dans le salon privé')
  denied(await api('GET', `/api/messages/${pMsg.id}/edits`, TB), 'lire l’historique d’un message privé')
  denied(await api('POST', `/api/messages/${pMsg.id}/forward`, { ...TB, body: { channel_id: ch.id } }), 'transférer un message privé')
  denied(await api('GET', `/api/reactions?message_id=${pMsg.id}&emoji=${e}`, TB), 'voir qui a réagi à un message privé')
  const gs = must(await api('GET', `/api/search?q=${secret}`, TB), 'recherche globale B')
  check((gs.messages ?? []).length === 0 && !(gs.channels ?? []).some((c) => c.id === priv.id), 'trouver le salon privé ou ses messages par la recherche globale', { status: 'trouvé' })
  const mentions = must(await api('GET', '/api/user/mentions', TB), 'mentions B')
  check(!(Array.isArray(mentions) ? mentions : []).some((m) => m.channel_id === priv.id), 'voir une mention du salon privé', { status: 'listée' })
  const unread = must(await api('GET', '/api/unread', TB), 'non-lus B')
  check(!(Array.isArray(unread) ? unread : []).some((u) => u.channel_id === priv.id), 'voir un compteur de non-lus du salon privé', { status: 'listé' })

  // Contrôle positif : une surcharge propre à B lui rend l'accès.
  must(await api('PUT', `/api/channels/${priv.id}/permissions/${B.id}`, { token: A.token, body: { target_type: 'member', allow: 1, deny: 0 } }), 'surcharge B')
  if ((await api('GET', `${pBase}/messages`, TB)).status !== 200) throw new Error('surcharge membre sans effet : test du salon privé inopérant')
  console.log('  ✓ (contrôle) une surcharge propre à B lui rend l’accès')

  console.log('\n-- Présence vocale --')
  {
    const open = async (who) => {
      const t = must(await api('POST', '/api/auth/ws-ticket', { token: who.token, body: {} }), 'ticket').ticket
      const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws?ticket=${encodeURIComponent(t)}`)
      const msgs = []
      ws.onmessage = (ev) => msgs.push(String(ev.data))
      await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = ko })
      return { ws, msgs }
    }
    const voice = must(await api('POST', `/api/servers/${srv.id}/channels`, { token: A.token, body: { name: 'vocal-authz', type: 'voice' } }), 'salon vocal')
    const hiddenVoice = must(await api('POST', `/api/servers/${srv.id}/channels`, { token: A.token, body: { name: 'vocal-prive', type: 'voice' } }), 'salon vocal privé')
    must(await api('PUT', `/api/channels/${hiddenVoice.id}/permissions/${everyone.id}`, { token: A.token, body: { target_type: 'role', allow: 0, deny: 1 } }), 'surcharge vocal privé')
    const [wa, wb, wc] = [await open(A), await open(B), await open(C)]
    await sleep(800)
    wa.ws.send(JSON.stringify({ type: 'VOICE_JOIN', channel_id: voice.id }))
    await sleep(1500)
    if (!wb.msgs.some((m) => m.includes('VOICE_USER_JOINED') && m.includes(voice.id))) throw new Error('B n’a pas vu A rejoindre le vocal : test inopérant')
    check(!wc.msgs.some((m) => m.includes('VOICE_') || m.includes(voice.id)), 'recevoir la présence vocale d’un serveur étranger (C)', { status: 'reçue' })
    wa.msgs.length = 0
    wb.ws.send(JSON.stringify({ type: 'VOICE_JOIN', channel_id: hiddenVoice.id }))
    await sleep(1500)
    check(!wb.msgs.some((m) => m.includes('VOICE_EXISTING_PEERS')) && !wa.msgs.some((m) => m.includes(hiddenVoice.id)), 'rejoindre un salon vocal privé (B)', { status: 'rejoint' })
    // « En train d'écrire » : B ne doit pas pouvoir l'afficher dans un salon qu'il ne voit pas.
    wa.msgs.length = 0
    wb.ws.send(JSON.stringify({ type: 'TYPING_START', channel_id: ch.id }))
    wb.ws.send(JSON.stringify({ type: 'TYPING_START', channel_id: hiddenVoice.id }))
    await sleep(1500)
    if (!wa.msgs.some((m) => m.includes('TYPING_START') && m.includes(ch.id))) throw new Error('A n’a pas vu B écrire dans le salon ouvert : test inopérant')
    check(!wa.msgs.some((m) => m.includes('TYPING_START') && m.includes(hiddenVoice.id)), 'afficher « en train d’écrire » dans un salon privé (B)', { status: 'reçu' })
    for (const w of [wa, wb, wc]) w.ws.close()
  }

  console.log('\n-- Révocation des jetons (« Tout déconnecter », mot de passe) --')
  {
    const s = rand()
    const V = { username: `authzv${s}`, email: `authz_v_${s}@test.local`, password: `Authz-${s}-Passw0rd` }
    const reg = must(await api('POST', '/api/auth/register', { body: V }), 'inscription V')
    const sess = must(await api('GET', '/api/users/me/sessions', { token: reg.access_token }), 'sessions V')
    check(Array.isArray(sess) && sess.length >= 1, 'être absent de « Appareils connectés » après l’inscription', { status: 'absente' })
    const login = () => api('POST', '/api/auth/login', { body: { email: V.email, password: V.password } })
    const [l1, l2] = await Promise.all([login(), login()])
    const t1 = must(l1, 'connexion V1').access_token
    const t2 = must(l2, 'connexion V2').access_token
    check(t1 !== t2, 'recevoir le même jeton pour deux connexions simultanées', { status: 'identiques' })

    const ticket = must(await api('POST', '/api/auth/ws-ticket', { token: t2, body: {} }), 'ticket V2').ticket
    const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws?ticket=${encodeURIComponent(ticket)}`)
    const closed = new Promise((ok) => (ws.onclose = () => ok(true)))
    await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = ko })
    must(await api('POST', '/api/auth/logout', { token: t1, body: {} }), 'tout déconnecter depuis V1')
    denied(await api('GET', '/api/users/me', { token: t2 }), 'utiliser le jeton d’un autre appareil après « Tout déconnecter »')
    const wsClosed = await Promise.race([closed, sleep(3000).then(() => false)])
    check(wsClosed, 'garder sa WebSocket ouverte après « Tout déconnecter »', { status: 'ouverte' })
    if (!wsClosed) ws.close()

    await sleep(1100)
    const [m1, m2] = await Promise.all([login(), login()])
    const u1 = must(m1, 'reconnexion V1').access_token
    const u2 = must(m2, 'reconnexion V2').access_token
    must(await api('GET', '/api/users/me', { token: u2 }), 'nouvelle session valide')
    const newPw = `${V.password}-2`
    must(await api('POST', '/api/auth/change-password', { token: u1, body: { old_password: V.password, new_password: newPw } }), 'changement de mot de passe')
    denied(await api('GET', '/api/users/me', { token: u2 }), 'utiliser le jeton d’un autre appareil après un changement de mot de passe')
    denied(await api('GET', '/api/users/me', { token: u1 }), 'réutiliser son propre jeton après un changement de mot de passe')

    // Réutilisation d'un refresh token : dans le délai de grâce (deux onglets) → simple refus ;
    // au-delà → toute la famille est révoquée, et les jetons d'accès du compte avec.
    await sleep(1100)
    const r = must(await api('POST', '/api/auth/login', { body: { email: V.email, password: newPw } }), 'connexion R')
    const r1 = must(await api('POST', '/api/auth/refresh', { body: { refresh_token: r.refresh_token } }), 'rotation 1')
    denied(await api('POST', '/api/auth/refresh', { body: { refresh_token: r.refresh_token } }), 'réutiliser un refresh token déjà utilisé')
    const r2 = must(await api('POST', '/api/auth/refresh', { body: { refresh_token: r1.refresh_token } }), 'rotation 2 (grâce : famille intacte)')
    const hashOf = (t) => createHash('sha256').update(t).digest('base64')
    sql(`UPDATE refresh_tokens SET used_at = NOW() - INTERVAL '1 minute' WHERE token_hash = '${hashOf(r.refresh_token)}'`)
    denied(await api('POST', '/api/auth/refresh', { body: { refresh_token: r.refresh_token } }), 'réutiliser un vieux refresh token (vol simulé)')
    denied(await api('POST', '/api/auth/refresh', { body: { refresh_token: r2.refresh_token } }), 'garder la famille valide après une réutilisation')
    denied(await api('GET', '/api/users/me', { token: r2.access_token }), 'garder le jeton d’accès après une réutilisation')
  }

  console.log('\n-- Limite de connexion par compte (toutes IP confondues) --')
  {
    const s = rand()
    const L = { username: `authzl${s}`, email: `authz_l_${s}@test.local`, password: `Authz-${s}-Passw0rd` }
    // Inscription depuis une IP de test à part : la limite d'inscriptions par IP est déjà entamée.
    const reg = await fetch(`${BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.200' },
      body: JSON.stringify(L),
    })
    if (!reg.ok) throw new Error(`Préparation impossible (inscription L) : ${reg.status} ${await reg.text()}`)
    const attempt = (password, i) =>
      fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        // Une « IP » différente à chaque essai : seule la limite par compte peut bloquer.
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `198.51.100.${i}` },
        body: JSON.stringify({ email: L.email, password }),
      })
    for (let i = 1; i <= 20; i++) await attempt('mauvais-mot-de-passe', i)
    const after = await attempt(L.password, 99)
    check(after.status === 429, 'continuer à essayer des mots de passe sur un compte depuis des IP différentes', after)
  }

  console.log('\n-- Recherche globale : blocages, borne haute, limite de débit --')
  {
    const P = await user('p')
    const Q = await user('q')
    const sp = must(await api('POST', '/api/servers', { token: P.token, body: { name: `Serveur recherche ${rand()}` } }), 'serveur P')
    const ip = must(await api('POST', `/api/servers/${sp.id}/invites`, { token: P.token, body: { max_age: 3600 } }), 'invitation P')
    must(await api('POST', `/api/servers/join/${ip.code}`, { token: Q.token }), 'Q rejoint')
    const pch = must(await api('GET', `/api/servers/${sp.id}/channels`, { token: P.token }), 'salons P').find((c) => c.type === 'text')
    const word = `cherche${rand()}`
    must(await api('POST', `/api/servers/${sp.id}/channels/${pch.id}/messages`, { token: P.token, body: { content: `P dit ${word}` } }), 'message P')
    const before = must(await api('GET', `/api/search?q=${P.username}`, { token: Q.token }), 'recherche avant blocage')
    if (!before.users.some((u) => u.id === P.id)) throw new Error('Préparation impossible : P introuvable avant blocage')
    const msgBefore = must(await api('GET', `/api/search?q=${word}`, { token: Q.token }), 'recherche de messages avant blocage')
    if (msgBefore.messages.length !== 1) throw new Error('Préparation impossible : message de P introuvable avant blocage')
    must(await api('POST', `/api/friends/block/${P.id}`, { token: Q.token }), 'Q bloque P')
    const byQ = must(await api('GET', `/api/search?q=${P.username}`, { token: Q.token }), 'recherche de Q')
    check(!byQ.users.some((u) => u.id === P.id), 'voir dans la recherche un utilisateur qu’on a bloqué', { status: 200 })
    const msgs = must(await api('GET', `/api/search?q=${word}`, { token: Q.token }), 'recherche de messages de Q')
    check(msgs.messages.length === 0, 'voir dans la recherche les messages d’un utilisateur bloqué', { status: 200 })
    const byP = must(await api('GET', `/api/search?q=${Q.username}`, { token: P.token }), 'recherche de P')
    check(!byP.users.some((u) => u.id === Q.id), 'trouver par la recherche quelqu’un qui nous a bloqué', { status: 200 })
    const long = await api('GET', `/api/search?q=${'a'.repeat(101)}`, { token: P.token })
    check(long.status === 400, 'chercher avec une requête de plus de 100 caractères', long)
    let last
    for (let i = 0; i < 61; i++) last = await api('GET', `/api/search?q=zz${i}`, { token: P.token })
    check(last.status === 429, 'lancer plus de 60 recherches par minute', last)
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
