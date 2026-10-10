// Parcours réel du lot « Messages et discussion » contre un serveur ForgeChat LOCAL
// (Postgres et Redis jetables) : messages éphémères, réglages de salon, brouillons chiffrés,
// messages programmés (liste, modification rechiffrée, envoi immédiat), sondages anonymes.
// Usage : FORGECHAT_API_URL=http://127.0.0.1:58080 node scripts/messaging.api.mjs
import * as c from '../src/e2e/crypto.ts'
import * as A from './_auth.mjs'

const BASE = process.env.FORGECHAT_API_URL ?? 'http://127.0.0.1:58080'
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(BASE).hostname)) throw new Error('serveur local uniquement')

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

const { PASSWORD } = A
async function account(name) {
  const user = { username: `${name}${Math.random().toString(36).slice(2, 7)}`, email: `${name}${Date.now()}${Math.random().toString(36).slice(2, 6)}@test.local` }
  const token = (await A.register(api, user)).body?.access_token
  const me = (await api('GET', '/api/users/me', { token })).body
  const kp = await c.generateKeyPair()
  const wrapped = await c.wrapKey(kp.priv, PASSWORD, c.keyAad(me.id), { iterations: 1000 })
  await api('PUT', '/api/users/me/keys', { token, body: { public: c.b64uEncode(kp.pub), wrapped } })
  return { token, id: me.id, priv: await c.importPrivateKey(kp.priv, kp.pub), pub: kp.pub }
}

async function createEpoch(kind, id, me, members) {
  const list = (await api('GET', `/api/e2e/conversations/${kind}/${id}/members`, { token: me.token })).body
  const key = c.generateConvKey()
  const conv = c.convName(kind, id)
  const envelopes = []
  for (const m of members) {
    const info = list.find(x => x.user_id === m.id)
    envelopes.push({ member_id: m.id, member_fp: info.fingerprint, wrapped: await c.wrapConvKey(me.priv, m.pub, key, conv, 0, m.id, me.id) })
  }
  await api('POST', `/api/e2e/conversations/${kind}/${id}/keys`, { token: me.token, body: { epoch: 0, create: true, envelopes } })
  return key
}

const a = await account('alice')
const b = await account('bob')
const eve = await account('eve')

// ─── Messages éphémères d'un MP ─────────────────────────────────────────────
const dm = (await api('POST', `/api/dms/${b.id}`, { token: a.token })).body
const dmId = dm?.id ?? dm?.dm_id
const dmKey = await createEpoch('dm', dmId, a, [a, b])
const dmConv = c.convName('dm', dmId)
const sendDm = async (text) => {
  const cmid = crypto.randomUUID()
  const enc = await c.encryptMessage(dmKey, dmConv, 0, a.id, cmid, { t: text })
  return api('POST', `/api/dms/${dmId}/messages`, { token: a.token, body: { content: null, enc, client_msg_id: cmid } })
}
ok((await api('GET', `/api/disappearing/dm/${dmId}`, { token: a.token })).body?.seconds === null, 'MP : messages éphémères désactivés au départ')
ok((await api('PUT', `/api/disappearing/dm/${dmId}`, { token: a.token, body: { seconds: 42 } })).status === 400, 'MP : durée inconnue refusée')
ok((await api('PUT', `/api/disappearing/dm/${dmId}`, { token: eve.token, body: { seconds: 3600 } })).status === 403, 'MP : un non-membre ne change rien (403)')
ok((await api('GET', `/api/disappearing/channel/${dmId}`, { token: a.token })).status === 404, 'route des MP/groupes : pas de salon')
const set1h = await api('PUT', `/api/disappearing/dm/${dmId}`, { token: b.token, body: { seconds: 3600 } })
ok(set1h.status === 200 && set1h.body?.seconds === 3600, 'MP : l’autre membre règle 1 h', JSON.stringify(set1h.body))
const m1 = await sendDm('disparaît dans une heure')
const left = Date.parse(m1.body?.expires_at) - Date.now()
ok(m1.status === 200 && left > 3500_000 && left <= 3600_000, 'MP : échéance posée par le serveur (+1 h)', JSON.stringify(m1.body))
await api('PUT', `/api/disappearing/dm/${dmId}`, { token: a.token, body: { seconds: 0 } })
const m2 = await sendDm('après lecture')
ok(m2.body?.expire_on_read === true && !m2.body?.expires_at, 'MP : « après lecture » marqué, sans échéance avant lecture')
const listed = (await api('GET', `/api/dms/${dmId}/messages`, { token: b.token })).body
ok(listed.find(m => m.id === m2.body.id)?.expire_on_read === true && !!listed.find(m => m.id === m1.body.id)?.expires_at, 'MP : liste des messages avec échéances')
await api('PUT', `/api/disappearing/dm/${dmId}`, { token: a.token, body: { seconds: null } })
ok(!(await sendDm('normal')).body?.expires_at, 'MP : désactivé, plus d’échéance')

// ─── Salon : réglages de discussion, message programmé, sondages ───────────
const server = (await api('POST', '/api/servers', { token: a.token, body: { name: 'Serveur lot messages' } })).body
const serverId = server?.id ?? server?.server?.id
const channels = (await api('GET', `/api/servers/${serverId}`, { token: a.token })).body?.channels ?? []
const channelId = channels.find(ch => ch.type === 'text')?.id
const chKey = await createEpoch('channel', channelId, a, [a])
const chConv = c.convName('channel', channelId)
const messaging = (body, token = a.token) => api('PUT', `/api/servers/${serverId}/channels/${channelId}/messaging`, { token, body })
ok((await messaging({ disappear_seconds: 0 })).status === 400, 'salon : « après lecture » refusé')
ok((await messaging({ auto_threads: true }, b.token)).status === 403, 'salon : réglage refusé à un non-membre')
const setCh = await messaging({ disappear_seconds: 86400, auto_threads: true })
ok(setCh.status === 200 && setCh.body?.disappear_seconds === 86400 && setCh.body?.auto_threads === true, 'salon : 24 h et fils automatiques', JSON.stringify(setCh.body))
const chList = (await api('GET', `/api/servers/${serverId}/channels`, { token: a.token })).body
ok(chList.find(ch => ch.id === channelId)?.auto_threads === true && chList.find(ch => ch.id === channelId)?.disappear_seconds === 86400, 'salon : réglages dans la liste des salons')
const chCmid = crypto.randomUUID()
const chMsg = await api('POST', `/api/servers/${serverId}/channels/${channelId}/messages`, {
  token: a.token, body: { content: null, enc: await c.encryptMessage(chKey, chConv, 0, a.id, chCmid, { t: 'salon éphémère' }), client_msg_id: chCmid },
})
const chLeft = Date.parse(chMsg.body?.expires_at) - Date.now()
ok(chLeft > 86_000_000 && chLeft <= 86_400_000, 'salon : échéance du réglage du salon (+24 h)', JSON.stringify(chMsg.body).slice(0, 200))
await messaging({ disappear_seconds: null })

const schedCmid = crypto.randomUUID()
const sched = await api('POST', `/api/servers/${serverId}/channels/${channelId}/scheduled`, {
  token: a.token,
  body: { content: '', send_at: new Date(Date.now() + 3600_000).toISOString(), enc: await c.encryptMessage(chKey, chConv, 0, a.id, schedCmid, { t: 'programmé' }), client_msg_id: schedCmid },
})
ok(sched.status === 200 && sched.body?.content === null, 'programmé : créé chiffré (aucun texte côté serveur)', JSON.stringify(sched.body))
const all = (await api('GET', '/api/scheduled', { token: a.token })).body
ok(Array.isArray(all) && all.length === 1 && all[0].channel_name && all[0].server_name === 'Serveur lot messages', '« À envoyer » : liste avec salon et serveur', JSON.stringify(all))
const opened = await c.decryptMessage(chKey, chConv, all[0].enc, a.id, all[0].client_msg_id)
ok(opened.t === 'programmé', '« À envoyer » : texte déchiffré sur l’appareil')
ok((await api('PATCH', `/api/scheduled/${sched.body.id}`, { token: b.token, body: { send_at: new Date(Date.now() + 7200_000).toISOString() } })).status === 404, 'programmé : un autre compte ne le modifie pas (404)')
ok((await api('PATCH', `/api/scheduled/${sched.body.id}`, { token: a.token, body: { send_at: new Date(Date.now() - 1000).toISOString() } })).status === 400, 'programmé : date passée refusée')
const newCmid = crypto.randomUUID()
const patched = await api('PATCH', `/api/scheduled/${sched.body.id}`, {
  token: a.token,
  body: { send_at: new Date(Date.now() + 7200_000).toISOString(), enc: await c.encryptMessage(chKey, chConv, 0, a.id, newCmid, { t: 'programmé modifié' }), client_msg_id: newCmid },
})
ok(patched.status === 200 && patched.body?.client_msg_id === newCmid, 'programmé : texte rechiffré et date modifiés', JSON.stringify(patched.body))
const now = await api('POST', `/api/scheduled/${sched.body.id}/send`, { token: a.token })
ok(now.status === 200, 'programmé : envoyer maintenant')
const chMsgs = (await api('GET', `/api/servers/${serverId}/channels/${channelId}/messages`, { token: a.token })).body
const sentNow = chMsgs.find(m => m.client_msg_id === newCmid)
ok(!!sentNow && (await c.decryptMessage(chKey, chConv, sentNow.enc, a.id, newCmid)).t === 'programmé modifié', 'programmé : publié une seule fois, déchiffrable', String(chMsgs.filter(m => m.client_msg_id === newCmid).length))
ok(chMsgs.filter(m => m.client_msg_id === newCmid).length === 1, 'programmé : pas de double envoi')
ok(((await api('GET', '/api/scheduled', { token: a.token })).body ?? []).length === 0, '« À envoyer » : vide après l’envoi')
ok((await api('POST', `/api/scheduled/${sched.body.id}/send`, { token: a.token })).status === 404, 'programmé : déjà envoyé, plus rien à envoyer')

const poll = async (anonymous) => {
  const cmid = crypto.randomUUID()
  const enc = await c.encryptMessage(chKey, c.pollScope(channelId, cmid), 0, a.id, cmid, { t: 'Pizza ?', o: ['Oui', 'Non'] })
  return (await api('POST', `/api/servers/${serverId}/channels/${channelId}/polls`, {
    token: a.token, body: { question: '', options: ['', ''], enc, client_msg_id: cmid, multiple_choice: true, anonymous, ends_at: new Date(Date.now() + 86400_000).toISOString() },
  })).body
}
const anon = await poll(true)
ok(anon?.anonymous === true && anon?.multiple_choice === true && !!anon?.ends_at, 'sondage anonyme, choix multiples, date limite')
await api('POST', `/api/servers/${serverId}/channels/${channelId}/polls/${anon.id}/vote`, { token: a.token, body: { option_ids: anon.options.map(o => o.id) } })
ok((await api('GET', `/api/servers/${serverId}/channels/${channelId}/polls/${anon.id}/voters`, { token: a.token })).status === 403, 'sondage anonyme : votants jamais révélés (403)')
const open = await poll(false)
await api('POST', `/api/servers/${serverId}/channels/${channelId}/polls/${open.id}/vote`, { token: a.token, body: { option_ids: [open.options[1].id] } })
const voters = (await api('GET', `/api/servers/${serverId}/channels/${channelId}/polls/${open.id}/voters`, { token: a.token })).body
ok(voters?.[open.options[1].id]?.[0]?.id === a.id && !voters?.[open.options[0].id], 'sondage public : votants par option')
const pastDeadline = await api('POST', `/api/servers/${serverId}/channels/${channelId}/polls`, {
  token: a.token, body: { question: 'q', options: ['a', 'b'], ends_at: new Date(Date.now() - 1000).toISOString() },
})
ok(pastDeadline.status === 400, 'sondage : date limite passée refusée')

// ─── Brouillons chiffrés ────────────────────────────────────────────────────
const draftKey = await c.draftKey(a.priv, a.pub, a.id)
const blob = await c.sealDraft(draftKey, a.id, dmId, 'brouillon secret')
ok((await api('PUT', `/api/drafts/${dmId}`, { token: a.token, body: blob })).status === 200, 'brouillon chiffré enregistré')
ok((await api('PUT', `/api/drafts/${dmId}`, { token: a.token, body: { ...blob, t: 'texte en clair' } })).status >= 400, 'brouillon : champ en clair refusé')
ok((await api('PUT', `/api/drafts/${dmId}`, { token: a.token, body: { v: 1, iv: 'x', ct: blob.ct } })).status === 400, 'brouillon : IV invalide refusé')
const drafts = (await api('GET', '/api/drafts', { token: a.token })).body
ok(drafts.length === 1 && await c.openDraft(draftKey, a.id, drafts[0].conv_id, drafts[0].blob) === 'brouillon secret', 'brouillon relu et déchiffré sur un autre appareil')
ok(((await api('GET', '/api/drafts', { token: b.token })).body ?? []).length === 0, 'brouillons : chacun ne voit que les siens')
ok((await api('DELETE', `/api/drafts/${dmId}`, { token: a.token })).status === 204, 'brouillon effacé')
ok(((await api('GET', '/api/drafts', { token: a.token })).body ?? []).length === 0, 'brouillons : plus rien après effacement')

console.log(failed ? `\n${failed} échec(s)` : '\nTout est passé.')
process.exit(failed ? 1 : 0)
