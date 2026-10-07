// Parcours réel des fichiers chiffrés de bout en bout (docs/CHIFFREMENT-E2E.md §12) contre un
// serveur ForgeChat LOCAL (Postgres et Redis jetables) : MP et salon, blob opaque envoyé,
// fichier en clair refusé, blob relu et déchiffré par le destinataire.
// Usage : FORGECHAT_API_URL=http://127.0.0.1:58080 node scripts/e2e-files.api.mjs
// Écrit le marqueur en clair utilisé dans les fichiers : le chercher ensuite dans le pg_dump et
// dans le dossier des envois (il ne doit apparaître nulle part).
import * as c from '../src/e2e/crypto.ts'

const BASE = process.env.FORGECHAT_API_URL ?? 'http://127.0.0.1:58080'
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(BASE).hostname)) throw new Error('serveur local uniquement')
export const MARKER = 'FORGECHAT-PLAINTEXT-MARKER-7f3a'

let failed = 0
const ok = (cond, label, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${cond || !extra ? '' : ` — ${extra}`}`)
  if (!cond) failed++
}

async function api(method, path, { token, body, form } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(BASE + path, { method, headers, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, body: json }
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
  const keys = await api('PUT', '/api/users/me/keys', { token, body: { public: c.b64uEncode(kp.pub), wrapped } })
  ok(keys.status === 200, `clé de compte de ${name}`, JSON.stringify(keys.body))
  return { token, id: me.id, priv: await c.importPrivateKey(kp.priv, kp.pub), pub: kp.pub }
}

/** Contenu de test : le marqueur répété sur ~150 Kio (3 morceaux). */
const plainFile = () => c.utf8(`${MARKER}\n`.repeat(4000))

async function sealFile(name, mime, data) {
  const id = crypto.randomUUID()
  const key = c.randomBytes(32)
  const blob = await c.encryptFileBytes(key, id, data)
  return { entry: { id, k: c.b64uEncode(key), n: name, m: mime, s: data.length }, blob }
}

const form = (name, bytes, type = 'application/octet-stream') => {
  const f = new FormData()
  f.append('files', new Blob([bytes], { type }), name)
  return f
}

/** Époque 0 de la conversation, enveloppée pour les membres donnés. */
async function createEpoch(kind, id, me, members) {
  const list = (await api('GET', `/api/e2e/conversations/${kind}/${id}/members`, { token: me.token })).body
  const key = c.generateConvKey()
  const conv = c.convName(kind, id)
  const envelopes = []
  for (const m of members) {
    const info = list.find(x => x.user_id === m.id)
    envelopes.push({ member_id: m.id, member_fp: info.fingerprint, wrapped: await c.wrapConvKey(me.priv, m.pub, key, conv, 0, m.id, me.id) })
  }
  const r = await api('POST', `/api/e2e/conversations/${kind}/${id}/keys`, { token: me.token, body: { epoch: 0, create: true, envelopes } })
  ok(r.status === 200, `époque 0 de ${conv}`, JSON.stringify(r.body))
  return key
}

async function downloadAndOpen(url, entry) {
  const res = await fetch(BASE + url)
  const bytes = new Uint8Array(await res.arrayBuffer())
  ok(res.ok && !Buffer.from(bytes).includes(Buffer.from(MARKER)), `blob ${url} servi sans aucun octet en clair`)
  return c.decryptFileBytes(c.b64uDecode(entry.k), entry.id, bytes, entry.s)
}

const a = await account('alice')
const b = await account('bob')

// ─── MP ─────────────────────────────────────────────────────────────────────
const dm = (await api('POST', `/api/dms/${b.id}`, { token: a.token })).body
const dmId = dm?.id ?? dm?.dm_id
ok(!!dmId, 'MP ouvert', JSON.stringify(dm))
const dmKey = await createEpoch('dm', dmId, a, [a, b])
const conv = c.convName('dm', dmId)

// Message en clair (sans texte) puis fichier en clair : refusé (tous les membres ont une clé).
const plainMsg = await api('POST', `/api/dms/${dmId}/messages`, { token: a.token, body: { content: '', has_attachments: true } })
const refused = await api('POST', `/api/dms/${dmId}/messages/${plainMsg.body?.id}/attachments`, { token: a.token, form: form('notes.txt', plainFile(), 'text/plain') })
ok(refused.status === 400 && String(refused.body?.error ?? '').startsWith('PLAINTEXT_REFUSED'), 'MP : fichier en clair refusé (PLAINTEXT_REFUSED)', JSON.stringify(refused.body))

const f1 = await sealFile('notes.txt', 'text/plain', plainFile())
const cmid = crypto.randomUUID()
const enc = await c.encryptMessage(dmKey, conv, 0, a.id, cmid, { t: '', f: [f1.entry] })
const sent = await api('POST', `/api/dms/${dmId}/messages`, { token: a.token, body: { content: null, enc, client_msg_id: cmid, has_attachments: true } })
ok(sent.status === 200 || sent.status === 201, 'MP : message chiffré portant le fichier', JSON.stringify(sent.body))
const msgId = sent.body?.id
const badName = await api('POST', `/api/dms/${dmId}/messages/${msgId}/attachments`, { token: a.token, form: form('notes.txt', f1.blob) })
ok(badName.status === 400, 'MP : message chiffré + fichier au nom en clair refusé')
const up = await api('POST', `/api/dms/${dmId}/messages/${msgId}/attachments`, { token: a.token, form: form(c.blobName(f1.entry.id), f1.blob) })
const att = up.body?.[0]
ok(up.status === 200 && att?.content_type === 'application/octet-stream' && att?.filename === c.blobName(f1.entry.id) && /\/uploads\/[0-9a-f-]{36}\.enc$/.test(att?.url),
  'MP : blob opaque rangé (octet-stream, nom aléatoire)', JSON.stringify(up.body))

// Bob relit le message, ouvre la clé d'époque, déchiffre le message puis le fichier.
const list = (await api('GET', `/api/dms/${dmId}/messages`, { token: b.token })).body
const got = list.find(m => m.id === msgId)
const envs = (await api('GET', `/api/e2e/conversations/dm/${dmId}/keys`, { token: b.token })).body
const env = envs.envelopes.find(e => e.epoch === 0)
const bKey = await c.unwrapConvKey(b.priv, c.b64uDecode(env.wrapped_by_pub), env.wrapped, conv, 0, b.id, env.wrapped_by)
const body = await c.decryptMessage(bKey, conv, got.enc, a.id, got.client_msg_id)
const entry = c.fileEntries(body)[0]
const gotAtt = got.attachments.find(x => x.filename === c.blobName(entry.id))
const opened = await downloadAndOpen(gotAtt.url, entry)
ok(new TextDecoder().decode(opened) === new TextDecoder().decode(plainFile()), 'MP : Bob déchiffre le fichier à l’identique')

// ─── Salon ──────────────────────────────────────────────────────────────────
const server = (await api('POST', '/api/servers', { token: a.token, body: { name: 'Serveur fichiers' } })).body
const serverId = server?.id ?? server?.server?.id
const channels = (await api('GET', `/api/servers/${serverId}`, { token: a.token })).body?.channels ?? []
const channelId = channels.find(ch => ch.type === 'text' || ch.channel_type === 'text')?.id ?? channels[0]?.id
ok(!!channelId, 'salon texte du serveur', JSON.stringify(channels).slice(0, 200))
const chKey = await createEpoch('channel', channelId, a, [a])
const chConv = c.convName('channel', channelId)
const plainCh = await api('POST', `/api/servers/${serverId}/channels/${channelId}/messages`, { token: a.token, body: { content: null, has_attachments: true } })
const chRefused = await api('POST', `/api/servers/${serverId}/channels/${channelId}/messages/${plainCh.body?.id}/attachments`, { token: a.token, form: form('photo.png', plainFile(), 'image/png') })
ok(chRefused.status === 400 && String(chRefused.body?.error ?? '').startsWith('PLAINTEXT_REFUSED'), 'salon : fichier en clair refusé (auteur muni d’une clé)', JSON.stringify(chRefused.body))
const f2 = await sealFile('photo.png', 'image/png', plainFile())
const cmid2 = crypto.randomUUID()
const enc2 = await c.encryptMessage(chKey, chConv, 0, a.id, cmid2, { t: 'avec un fichier', f: [f2.entry] })
const sent2 = await api('POST', `/api/servers/${serverId}/channels/${channelId}/messages`, { token: a.token, body: { content: null, enc: enc2, client_msg_id: cmid2, has_attachments: true } })
const up2 = await api('POST', `/api/servers/${serverId}/channels/${channelId}/messages/${sent2.body?.id}/attachments`, { token: a.token, form: form(c.blobName(f2.entry.id), f2.blob) })
ok(up2.status === 200 && up2.body?.[0]?.content_type === 'application/octet-stream', 'salon : blob opaque rangé', JSON.stringify(up2.body))
const back = await downloadAndOpen(up2.body[0].url, f2.entry)
ok(back.length === f2.entry.s, 'salon : fichier relu et déchiffré')

// Média de forum : en clair refusé à un auteur muni d'une clé, blob chiffré accepté.
const forumPlain = await api('POST', `/api/servers/${serverId}/channels/${channelId}/forum-uploads`, { token: a.token, form: form('image.png', plainFile(), 'image/png') })
ok(forumPlain.status === 400, 'média de forum en clair refusé', JSON.stringify(forumPlain.body))
const f3 = await sealFile('image.png', 'image/png', plainFile())
const forumEnc = await api('POST', `/api/servers/${serverId}/channels/${channelId}/forum-uploads`, { token: a.token, form: form(c.blobName(f3.entry.id), f3.blob) })
ok(forumEnc.status === 200 && /\.enc$/.test(forumEnc.body?.url ?? ''), 'média de forum chiffré accepté', JSON.stringify(forumEnc.body))

console.log(failed ? `\n${failed} échec(s)` : '\nTout est passé.')
process.exit(failed ? 1 : 0)
