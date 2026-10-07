// Parcours réel du lot « Serveurs et communauté » contre un serveur ForgeChat LOCAL
// (Postgres et Redis jetables) : modèles (Jötunheim), événements (.ics, récurrence),
// niveaux, starboard (référence chiffrée), tickets (salon privé), bienvenue, AutoMod
// avancé et verrouillage, journal d'audit filtré, statistiques, annuaire.
// Usage : FORGECHAT_API_URL=http://127.0.0.1:58081 node scripts/community.api.mjs
import * as c from '../src/e2e/crypto.ts'

const BASE = process.env.FORGECHAT_API_URL ?? 'http://127.0.0.1:58081'
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(BASE).hostname)) throw new Error('serveur local uniquement')

let failed = 0
const ok = (cond, label, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${cond || !extra ? '' : ` — ${extra}`}`)
  if (!cond) failed++
}
const j = (v) => JSON.stringify(v)?.slice(0, 300)

async function api(method, path, { token, body } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, body: json, headers: res.headers }
}

const PASSWORD = 'Mot de passe de test 42!'
async function account(name) {
  const user = { username: `${name}${Math.random().toString(36).slice(2, 7)}`, email: `${name}${Date.now()}${Math.random().toString(36).slice(2, 6)}@test.local`, password: PASSWORD }
  const reg = await api('POST', '/api/auth/register', { body: user })
  const login = await api('POST', '/api/auth/login', { body: { email: user.email, password: PASSWORD } })
  const token = login.body?.access_token ?? reg.body?.access_token
  const me = (await api('GET', '/api/users/me', { token })).body
  const kp = await c.generateKeyPair()
  const wrapped = await c.wrapKey(kp.priv, PASSWORD, c.keyAad(me.id), { iterations: 1000 })
  await api('PUT', '/api/users/me/keys', { token, body: { public: c.b64uEncode(kp.pub), wrapped } })
  return { token, id: me.id, name: user.username, priv: await c.importPrivateKey(kp.priv, kp.pub), pub: kp.pub }
}

async function sendEncrypted(srv, ch, who, members) {
  const list = (await api('GET', `/api/e2e/conversations/channel/${ch}/members`, { token: who.token })).body
  const key = c.generateConvKey()
  const conv = c.convName('channel', ch)
  const envelopes = []
  for (const m of members) {
    const info = list.find(x => x.user_id === m.id)
    envelopes.push({ member_id: m.id, member_fp: info.fingerprint, wrapped: await c.wrapConvKey(who.priv, m.pub, key, conv, 0, m.id, who.id) })
  }
  await api('POST', `/api/e2e/conversations/channel/${ch}/keys`, { token: who.token, body: { epoch: 0, create: true, envelopes } })
  const cmid = crypto.randomUUID()
  const enc = await c.encryptMessage(key, conv, 0, who.id, cmid, { t: 'message à mettre en avant' })
  return api('POST', `/api/servers/${srv}/channels/${ch}/messages`, { token: who.token, body: { content: null, enc, client_msg_id: cmid } })
}

const owner = await account('owner')
const bob = await account('bob')
const carol = await account('carol')

// ─── 21. Modèles ────────────────────────────────────────────────────────────
const tpls = (await api('GET', '/api/templates', { token: owner.token })).body
ok(tpls?.builtin?.map(t => t.id).join() === 'gaming,friends,community,study,creator,jotunheim', 'modèles intégrés listés', j(tpls?.builtin?.map(t => t.id)))
const jot = await api('POST', '/api/servers', { token: owner.token, body: { name: 'Jötunheim test', template: 'jotunheim', is_public: true } })
ok(jot.status === 200, 'serveur créé depuis Jötunheim', j(jot.body))
const S = jot.body.id
const full = (await api('GET', `/api/servers/${S}`, { token: owner.token })).body
ok(full.channels.length === 0, 'Jötunheim : AUCUN salon', j(full.channels))
const cats = (await api('GET', `/api/servers/${S}/categories`, { token: owner.token })).body
ok(cats.length === 12 && cats[0].name === '・・・INFORMATION・・・' && cats[11].name === '・・・VIDEO・・・', 'Jötunheim : 12 catégories dans l’ordre', j(cats.map(x => x.name)))
const adminCat = cats.find(x => x.name === '・・・ADMINISTRATEUR・・・')
ok(adminCat?.staff_only === true, 'ADMINISTRATEUR réservée aux admins')
ok((await api('POST', '/api/servers', { token: owner.token, body: { name: 'x', template: 'inconnu' } })).status === 400, 'modèle inconnu refusé')

await api('POST', `/api/servers/join/${jot.body.invite_code}`, { token: bob.token })
const bobCats = (await api('GET', `/api/servers/${S}/categories`, { token: bob.token })).body
ok(bobCats.length === 11 && !bobCats.some(x => x.staff_only), 'un membre ne voit pas la catégorie ADMINISTRATEUR', j(bobCats.map(x => x.name)))
const adminCh = (await api('POST', `/api/servers/${S}/channels`, { token: owner.token, body: { name: 'admins', category_id: adminCat.id } })).body
const gen = (await api('POST', `/api/servers/${S}/channels`, { token: owner.token, body: { name: 'général', category_id: cats[2].id } })).body
const bobView = (await api('GET', `/api/servers/${S}`, { token: bob.token })).body
ok(!bobView.channels.some(x => x.id === adminCh.id) && bobView.channels.some(x => x.id === gen.id), 'salon créé dans ADMINISTRATEUR : invisible pour un membre')

const saved = await api('POST', `/api/servers/${S}/template`, { token: owner.token, body: { name: 'Mon modèle' } })
ok(saved.status === 200 && saved.body.template_data.categories.some(x => x.staff_only), 'serveur enregistré comme modèle (structure seule)', j(saved.body))
const priv = saved.body.template_data.channels.find(x => x.name === 'admins')
ok(priv?.overrides?.some(o => o.role === 'everyone' && (o.deny & 1)), 'le salon privé reste privé dans le modèle', j(priv))
const used = await api('POST', `/api/templates/${saved.body.id}/use`, { token: owner.token, body: { name: 'Copie' } })
ok(used.status === 200, 'serveur recréé depuis mon modèle', j(used.body))
const copyCh = (await api('GET', `/api/servers/${used.body.id}`, { token: owner.token })).body.channels
ok(copyCh.length === 2 && copyCh.every(x => !x.last_message_id), 'copie : 2 salons, aucun message', j(copyCh.map(x => x.name)))

// ─── 22. Événements ─────────────────────────────────────────────────────────
const start = new Date(Date.now() + 3 * 60_000).toISOString()
const ev = await api('POST', `/api/servers/${S}/events`, { token: owner.token, body: { name: 'Soirée; quiz', start_time: start, recurrence: 'weekly', reminder_minutes: 5 } })
ok(ev.status === 200 && ev.body.recurrence === 'weekly' && ev.body.reminder_minutes === 5, 'événement récurrent avec rappel', j(ev.body))
ok((await api('POST', `/api/servers/${S}/events`, { token: owner.token, body: { name: 'x', start_time: start, recurrence: 'yearly' } })).status === 400, 'récurrence invalide refusée')
const ics = await api('GET', `/api/servers/${S}/events/${ev.body.id}/ics`, { token: bob.token })
ok(ics.status === 200 && ics.headers.get('content-type')?.startsWith('text/calendar') && String(ics.body).includes('RRULE:FREQ=WEEKLY') && String(ics.body).includes('SUMMARY:Soirée\\; quiz'), 'export .ics d’un événement', String(ics.body).slice(0, 200))
const allIcs = await api('GET', `/api/servers/${S}/events.ics`, { token: bob.token })
ok(allIcs.status === 200 && String(allIcs.body).includes('BEGIN:VEVENT'), 'export .ics du serveur')
ok((await api('GET', `/api/servers/${S}/events.ics`, { token: carol.token })).status === 403, '.ics refusé à un non-membre')

// ─── 23. Niveaux ────────────────────────────────────────────────────────────
const role = (await api('POST', `/api/servers/${S}/roles`, { token: owner.token, body: { name: 'Habitué', permissions: 1 } })).body
const modRole = (await api('POST', `/api/servers/${S}/roles`, { token: owner.token, body: { name: 'Modo', permissions: 8 } })).body
ok((await api('PUT', `/api/servers/${S}/levels`, { token: owner.token, body: { enabled: true, xp_per_message: 150, xp_per_voice_minute: 10, roles: [{ level: 1, role_id: modRole.id }] } })).status === 400, 'rôle sensible refusé comme récompense de niveau')
const lv = await api('PUT', `/api/servers/${S}/levels`, { token: owner.token, body: { enabled: true, xp_per_message: 150, xp_per_voice_minute: 10, roles: [{ level: 1, role_id: role.id }] } })
ok(lv.status === 200, 'niveaux activés', j(lv.body))
ok((await api('PUT', `/api/servers/${S}/levels`, { token: bob.token, body: { enabled: false, xp_per_message: 1, xp_per_voice_minute: 1 } })).status === 403, 'réglage des niveaux réservé')

// ─── 24. Starboard ──────────────────────────────────────────────────────────
const star = (await api('POST', `/api/servers/${S}/channels`, { token: owner.token, body: { name: 'starboard', category_id: cats[0].id } })).body
ok((await api('PUT', `/api/servers/${S}/starboard`, { token: owner.token, body: { enabled: true, channel_id: star.id, emoji: '⭐', threshold: 2 } })).status === 200, 'starboard réglé')
const msg = await sendEncrypted(S, gen.id, bob, [owner, bob])
ok(msg.status === 200, 'message chiffré envoyé', j(msg.body))
await new Promise(r => setTimeout(r, 500))
const card = (await api('GET', `/api/servers/${S}/levels/members/${bob.id}`, { token: owner.token })).body
ok(card.xp === 150 && card.level === 1 && card.rank === 1, 'XP gagnée par le fait d’écrire, niveau 1', j(card))
const msg2 = await sendEncrypted(S, gen.id, bob, [owner, bob]).catch(() => null)
await new Promise(r => setTimeout(r, 500))
ok((await api('GET', `/api/servers/${S}/levels/members/${bob.id}`, { token: owner.token })).body.xp === 150, 'plafond : pas de 2e gain dans la minute', j(msg2?.status))
const bobFull = (await api('GET', `/api/servers/${S}`, { token: bob.token })).body
ok(bobFull.my_role_ids.includes(role.id), 'rôle débloqué au niveau 1')
const board = (await api('GET', `/api/servers/${S}/levels/leaderboard`, { token: bob.token })).body
ok(board[0]?.user_id === bob.id, 'classement', j(board))

const emoji = encodeURIComponent('⭐')
await api('PUT', `/api/servers/${S}/channels/${gen.id}/messages/${msg.body.id}/reactions/${emoji}`, { token: owner.token })
await api('PUT', `/api/servers/${S}/channels/${gen.id}/messages/${msg.body.id}/reactions/${emoji}`, { token: bob.token })
await new Promise(r => setTimeout(r, 800))
const starMsgs = (await api('GET', `/api/servers/${S}/channels/${star.id}/messages`, { token: owner.token })).body
const ref = starMsgs.find(m => m.type === 'starboard')
ok(ref?.system_meta?.source_message_id === msg.body.id && !String(ref.content).includes('mettre en avant'), 'starboard : référence publiée, aucun texte du message', j(starMsgs))
ok(starMsgs.filter(m => m.type === 'starboard').length === 1, 'starboard : publié une seule fois')

// ─── 25. Tickets ────────────────────────────────────────────────────────────
ok((await api('PUT', `/api/servers/${S}/tickets/settings`, { token: owner.token, body: { enabled: true, category_id: cats[1].id, staff_role_ids: [modRole.id] } })).status === 200, 'tickets natifs activés')
const tk = await api('POST', `/api/servers/${S}/tickets`, { token: carol.token, body: { title: 'secret' } })
ok(tk.status === 403, 'non-membre : pas de ticket')
await api('POST', `/api/servers/join/${jot.body.invite_code}`, { token: carol.token })
const t1 = await api('POST', `/api/servers/${S}/tickets`, { token: carol.token, body: { title: 'mon secret' } })
ok(t1.status === 200 && t1.body.channel_id && t1.body.title === 'Ticket #1', 'ticket ouvert : salon privé, aucun titre en clair stocké', j(t1.body))
const carolSees = (await api('GET', `/api/servers/${S}`, { token: carol.token })).body.channels.some(x => x.id === t1.body.channel_id)
const bobSees = (await api('GET', `/api/servers/${S}`, { token: bob.token })).body.channels.some(x => x.id === t1.body.channel_id)
ok(carolSees && !bobSees, 'salon du ticket : visible par l’auteur, pas par un autre membre')
const closed = await api('PATCH', `/api/servers/${S}/tickets/${t1.body.id}`, { token: carol.token, body: { status: 'closed' } })
ok(closed.status === 200 && closed.body.closed_at, 'ticket fermé', j(closed.body))
const ch1 = (await api('GET', `/api/servers/${S}`, { token: carol.token })).body.channels.find(x => x.id === t1.body.channel_id)
ok(ch1 && ch1.can_send === false, 'ticket fermé : lisible (transcription) mais plus inscriptible', j(ch1))
ok((await api('PATCH', `/api/servers/${S}/tickets/${t1.body.id}`, { token: bob.token, body: { status: 'open' } })).status === 403, 'autre membre : ne touche pas au ticket')

// ─── 26. Bienvenue ──────────────────────────────────────────────────────────
ok((await api('PUT', `/api/servers/${S}/welcome`, { token: owner.token, body: { enabled: true, channel_id: gen.id, text: 'Salut {user}, membre n°{count} de {server}' } })).status === 200, 'bienvenue réglée')
const dave = await account('dave')
await api('POST', `/api/servers/join/${jot.body.invite_code}`, { token: dave.token })
const genMsgs = (await api('GET', `/api/servers/${S}/channels/${gen.id}/messages`, { token: owner.token })).body
const w = genMsgs.find(m => m.type === 'welcome')
ok(w && w.author_id === dave.id && w.system_meta?.member_number === 4 && w.content === `Salut ${dave.name}, membre n°4 de Jötunheim test`, 'message de bienvenue (auteur, numéro de membre, variables)', j(w))

// ─── 27. AutoMod avancé et verrouillage ─────────────────────────────────────
const adv = await api('PUT', `/api/servers/${S}/automod/advanced`, { token: owner.token, body: { rate_limit_count: 1, rate_limit_seconds: 30, raid_join_count: 2, raid_join_seconds: 60, block_dangerous_links: true, blocked_domains: ['https://Mauvais.example/x'] } })
ok(adv.status === 200, 'AutoMod avancé réglé', j(adv.body))
await api('PUT', `/api/servers/${S}/automod`, { token: owner.token, body: { enabled: true, blocked_words: [], max_mentions: 0, max_links: 0, anti_spam: false, anti_caps: false } })
const rules = (await api('GET', `/api/servers/${S}/automod/rules`, { token: bob.token })).body
ok(rules.dangerous_domains.includes('mauvais.example') && rules.dangerous_domains.includes('grabify.link'), 'liens dangereux servis aux applis (liste locale)', j(rules))
const advAgain = (await api('GET', `/api/servers/${S}/automod/advanced`, { token: owner.token })).body
ok(advAgain.blocked_domains.join() === 'mauvais.example', 'le PUT AutoMod classique n’efface pas les réglages avancés', j(advAgain))
await sendEncrypted(S, gen.id, dave, [owner, bob, dave]).catch(() => null)
const rated = await api('POST', `/api/servers/${S}/channels/${gen.id}/messages`, { token: dave.token, body: { content: null, enc: { v: 1, epoch: 0, iv: 'x', ct: 'y' }, client_msg_id: crypto.randomUUID() } })
ok(rated.status === 429, 'anti-spam (débit) : 2e message en 30 s refusé', j(rated))
await api('PUT', `/api/servers/${S}/automod/advanced`, { token: owner.token, body: { rate_limit_count: 0, rate_limit_seconds: 10, raid_join_count: 2, raid_join_seconds: 60, block_dangerous_links: true, blocked_domains: [] } })
const eve = await account('eve')
const raid = await api('POST', `/api/servers/join/${jot.body.invite_code}`, { token: eve.token })
ok(raid.status === 200, 'arrivée qui déclenche l’anti-raid', j(raid.body))
const locked = (await api('GET', `/api/servers/${S}`, { token: bob.token })).body
ok(locked.lockdown === true && locked.channels.every(x => !x.can_send), 'vague d’arrivées : verrouillage automatique', j({ l: locked.lockdown }))
// (5 comptes au plus : l'inscription est limitée par adresse) carol sort puis veut revenir.
await api('POST', `/api/servers/${S}/leave`, { token: carol.token })
ok((await api('POST', `/api/servers/join/${jot.body.invite_code}`, { token: carol.token })).status === 403, 'verrouillé : plus personne ne rejoint')
const blocked = await api('POST', `/api/servers/${S}/channels/${gen.id}/messages`, { token: bob.token, body: { content: null, enc: { v: 1, epoch: 0, iv: 'x', ct: 'y' }, client_msg_id: crypto.randomUUID() } })
ok(blocked.status === 403, 'verrouillé : un membre n’écrit plus', j(blocked))
ok((await api('PUT', `/api/servers/${S}/lockdown`, { token: bob.token, body: { enabled: false } })).status === 403, 'un membre ne lève pas le verrouillage')
ok((await api('PUT', `/api/servers/${S}/lockdown`, { token: owner.token, body: { enabled: false } })).status === 200, 'verrouillage levé en un clic')
ok((await api('GET', `/api/servers/${S}`, { token: bob.token })).body.lockdown === false, 'plus verrouillé')

// ─── 28. Journal d'audit ────────────────────────────────────────────────────
const audit = (await api('GET', `/api/servers/${S}/audit?action=LOCKDOWN_ON`, { token: owner.token })).body
ok(audit.length === 1 && audit[0].details?.reason === 'raid', 'audit filtré par action', j(audit))
const byUser = (await api('GET', `/api/servers/${S}/audit?user_id=${dave.id}`, { token: owner.token })).body
ok(byUser.length > 0 && byUser.every(e => e.user_id === dave.id), 'audit filtré par auteur', j(byUser))
const search = (await api('GET', `/api/servers/${S}/audit?q=${encodeURIComponent('ticket #1')}`, { token: owner.token })).body
ok(search.length >= 1 && search.every(e => /ticket #1/i.test(`${e.target_name} ${e.username} ${e.action}`)), 'audit : recherche', j(search))
const future = (await api('GET', `/api/servers/${S}/audit?from=${encodeURIComponent(new Date(Date.now() + 3600_000).toISOString())}`, { token: owner.token })).body
ok(Array.isArray(future) && future.length === 0, 'audit : filtre de dates')
const facets = (await api('GET', `/api/servers/${S}/audit/facets`, { token: owner.token })).body
ok(facets.actions.includes('MEMBER_JOIN') && facets.users.length >= 3, 'audit : actions et auteurs des filtres', j(facets))
ok((await api('GET', `/api/servers/${S}/audit`, { token: bob.token })).status === 403, 'audit réservé')

// ─── 29. Statistiques ───────────────────────────────────────────────────────
const st = (await api('GET', `/api/servers/${S}/stats/history?days=7`, { token: owner.token })).body
const today = st.series?.at(-1)
ok(st.series?.length === 7 && today.joins >= 4 && today.messages >= 2 && today.members === st.member_count, 'statistiques : séries par jour', j(today))
ok(st.channels?.[0]?.id === gen.id, 'statistiques : salons actifs', j(st.channels))
ok((await api('GET', `/api/servers/${S}/stats/history`, { token: bob.token })).status === 403, 'statistiques réservées')

// ─── 30. Annuaire ───────────────────────────────────────────────────────────
ok((await api('PATCH', `/api/servers/${S}`, { token: owner.token, body: { server_category: 'gaming', discovery_tags: ['Jeux-Vidéo', 'fr'] } })).status === 200, 'catégorie et étiquettes de l’annuaire')
ok((await api('PATCH', `/api/servers/${S}`, { token: owner.token, body: { discovery_tags: ['<b>'] } })).status === 400, 'étiquette invalide refusée')
const dir = (await api('GET', `/api/explore?category=gaming&tag=fr&q=${encodeURIComponent('jötun')}&sort=activity`, { token: carol.token })).body
const mine = dir.find(x => x.id === S)
ok(mine && dir.every(x => x.category === 'gaming' && x.tags.includes('fr')) && mine.tags.includes('jeux-vidéo') && mine.activity >= 2, 'annuaire : catégorie, étiquette, recherche, activité', j(dir))
ok((await api('GET', '/api/explore?tag=absent', { token: carol.token })).body.length === 0, 'annuaire : étiquette absente')
const prof = (await api('GET', `/api/explore/${S}`, { token: carol.token })).body
ok(prof.id === S && prof.channel_count >= 3 && prof.upcoming_events >= 1, 'page de présentation', j(prof))
ok((await api('GET', `/api/explore/${used.body.id}`, { token: carol.token })).status === 404, 'serveur privé absent de l’annuaire')

console.log(failed ? `\n${failed} échec(s)` : '\nTout est passé.')
process.exit(failed ? 1 : 0)
