// Ajout d'amis contre un serveur ForgeChat LOCAL : une demande restée en attente ne bloque plus
// l'ajout (demandes croisées = amis, aussi par pseudo) et le lien d'invitation transforme la
// demande en amitié.
// Usage : FORGECHAT_API_URL=http://127.0.0.1:58081 node scripts/friends.api.mjs
const BASE = process.env.FORGECHAT_API_URL ?? 'http://127.0.0.1:58081'
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(BASE).hostname)) throw new Error('serveur local uniquement')

let failed = 0
const ok = (cond, label, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${cond || !extra ? '' : ` — ${extra}`}`)
  if (!cond) failed++
}
const j = (v) => JSON.stringify(v)?.slice(0, 300)

async function api(method, path, { token, body, ip } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  if (ip) headers['X-Real-IP'] = ip
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, body: json }
}

const PASSWORD = 'Mot de passe de test 42!'
async function account(username) {
  const email = `${username}${Date.now()}${Math.random().toString(36).slice(2, 6)}@test.local`
  await api('POST', '/api/auth/register', { body: { username, email, password: PASSWORD }, ip: `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` })
  const token = (await api('POST', '/api/auth/login', { body: { email, password: PASSWORD } })).body?.access_token
  const me = (await api('GET', '/api/users/me', { token })).body
  return { token, id: me?.id, tag: `${me?.username}#${me?.discriminator}` }
}
const friendsOf = async (u) => (await api('GET', '/api/friends', { token: u.token })).body ?? []
const isFriend = async (u, other) => (await friendsOf(u)).some(f => f.friend_id === other.id && f.status === 'accepted')

const sfx = Math.random().toString(36).slice(2, 6)
const momo = await account(`momo${sfx}`)
const vlad = await account(`vlad${sfx}`)
ok(momo.token && vlad.token, 'deux comptes créés')

// 1. Momo envoie une demande ; Vladidi, sans la voir, en envoie une à son tour.
let r = await api('POST', '/api/friends', { token: momo.token, body: { user_id: vlad.id } })
ok(r.status === 200 && r.body?.outcome === 'sent', 'demande envoyée', j(r))
r = await api('POST', '/api/friends', { token: momo.token, body: { user_id: vlad.id } })
ok(r.status === 409 && /attente/.test(j(r.body)), 'renvoyer la même demande : « en attente »', j(r))
r = await api('POST', '/api/friends', { token: vlad.token, body: { user_id: momo.id } })
ok(r.status === 200 && r.body?.outcome === 'accepted', 'demande croisée : acceptée au lieu de « déjà existante »', j(r))
ok(await isFriend(momo, vlad) && await isFriend(vlad, momo), 'amis des deux côtés')
r = await api('POST', '/api/friends', { token: vlad.token, body: { user_id: momo.id } })
ok(r.status === 409 && /déjà amis/.test(j(r.body)), 'déjà amis : message clair', j(r))

// 2. Lien d'invitation alors qu'une demande attend : il devient l'amitié.
const a = await account(`ana${sfx}`)
const b = await account(`ben${sfx}`)
await api('POST', '/api/friends', { token: b.token, body: { user_id: a.id } })
const code = (await api('POST', '/api/friends/invite', { token: a.token, body: {} })).body?.code
r = await api('POST', `/api/friend-invite/${code}/accept`, { token: b.token })
ok(r.status === 200, 'invitation acceptée', j(r))
ok(await isFriend(a, b) && await isFriend(b, a), 'invitation + demande en attente : amis (avant : rien ne se passait)')

// 3. Par pseudo : même logique.
r = await api('POST', '/api/friends/by-name', { token: vlad.token, body: { name: `ana${sfx}` } })
ok(r.status === 200 && r.body?.outcome === 'sent', 'par pseudo : demande envoyée', j(r))
r = await api('POST', '/api/friends/by-name', { token: a.token, body: { name: `vlad${sfx}` } })
ok(r.status === 200 && r.body?.outcome === 'accepted', 'par pseudo, demande croisée : acceptée', j(r))

// 4. Suggestions : tout membre de l'instance (sans relation commune), sauf les amis.
const solo = await account(`solo${sfx}`)
const sugg = (await api('GET', '/api/friends/suggestions', { token: solo.token })).body ?? []
ok(sugg.some(s => s.id === momo.id) && sugg.some(s => s.id === vlad.id), 'suggestions : membres sans ami ni serveur commun proposés', j(sugg.length))
const sMomo = (await api('GET', '/api/friends/suggestions', { token: momo.token })).body ?? []
ok(!sMomo.some(s => s.id === vlad.id) && sMomo.some(s => s.id === solo.id), 'suggestions : un ami n’est plus proposé', j(sMomo.map(s => s.username)))

console.log(failed ? `\n${failed} échec(s)` : '\nTout est vert')
process.exit(failed ? 1 : 0)
