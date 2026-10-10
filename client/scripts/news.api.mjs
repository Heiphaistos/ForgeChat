// Actualités (bot RSSDI) contre un serveur ForgeChat LOCAL : jeton de bot, lien validé, article rangé une
// fois, page publique (sites non publics exclus), publication dans le fil du forum sans doublon,
// fil d'un autre serveur refusé.
// Usage : FORGECHAT_API_URL=http://127.0.0.1:58081 FORGECHAT_PSQL=postgres://… node scripts/news.api.mjs
// (les fils de forum exigent le chiffrement : ceux du test sont posés directement en base par psql)
import { execFileSync } from 'node:child_process'
import * as A from './_auth.mjs'
const BASE = process.env.FORGECHAT_API_URL ?? 'http://127.0.0.1:58081'
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(BASE).hostname)) throw new Error('serveur local uniquement')

let failed = 0
const ok = (cond, label, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${cond || !extra ? '' : ` — ${extra}`}`)
  if (!cond) failed++
}
const j = (v) => JSON.stringify(v)?.slice(0, 300)
async function api(method, path, { token, bot, body, ip } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : bot ? { Authorization: `Bot ${bot}` } : {}
  if (ip) headers['X-Real-IP'] = ip
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, body: json }
}
async function account(username) {
  const email = `${username}${Date.now()}@test.local`
  return (await A.register(api, { username, email }, { ip: `10.8.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` })).body?.access_token
}

const sfx = Math.random().toString(36).slice(2, 6)
const owner = await account(`proprio${sfx}`)
const reader = await account(`lecteur${sfx}`)
const srv = (await api('POST', '/api/servers', { token: owner, body: { name: 'Jötunheim test' } })).body
const other = (await api('POST', '/api/servers', { token: owner, body: { name: 'Autre' } })).body
const bot = (await api('POST', `/api/servers/${srv.id}/bots`, { token: owner, body: { name: `RSSDI${sfx}` } })).body?.token
ok(!!bot, 'bot RSSDI créé', '')
const forum = (await api('POST', `/api/servers/${srv.id}/channels`, { token: owner, body: { name: 'Informatique', type: 'forum' } })).body
const PSQL = process.env.FORGECHAT_PSQL ?? 'postgres://forgechat:ci@127.0.0.1:5432/forgechat'
const sqlPost = (channel, title) => execFileSync('psql', [PSQL, '-At', '-c',
  `INSERT INTO forum_posts (channel_id, title, creator_id) SELECT '${channel}', '${title}', owner_id FROM servers s JOIN channels c ON c.server_id = s.id WHERE c.id = '${channel}' RETURNING id`], { encoding: 'utf8' }).trim().split(/\s+/)[0]
const postId = sqlPost(forum.id, 'Presse Citron')
ok(/^[0-9a-f-]{36}$/.test(postId), 'fil « Presse Citron » créé', postId)
const otherForum = (await api('POST', `/api/servers/${other.id}/channels`, { token: owner, body: { name: 'Ailleurs', type: 'forum' } })).body
const otherPostId = sqlPost(otherForum.id, 'Pas ici')

const art = (n, extra = {}) => ({ server_id: srv.id, site: 'Presse Citron', category: 'Informatique', title: `Article ${n}`, link: `https://www.presse-citron.net/a${n}/`, summary: `Résumé ${n}`, image: 'https://www.presse-citron.net/img.jpg', published_at: Math.floor(Date.now() / 1000) - n * 60, ...extra })

ok((await api('POST', '/api/bot/news', { bot: 'faux', body: art(1) })).status === 401, 'jeton inconnu refusé')
ok((await api('POST', '/api/bot/news', { bot, body: art(1, { link: 'javascript:alert(1)' }) })).status === 400, 'lien non http refusé')
let r = await api('POST', '/api/bot/news', { bot, body: art(1, { post_id: postId }) })
ok(r.status === 200 && r.body?.new === true && r.body?.posted === true, 'article rangé et publié dans le fil', j(r))
r = await api('POST', '/api/bot/news', { bot, body: art(1, { post_id: postId }) })
ok(r.body?.new === false && r.body?.posted === false, 'même article : ni doublon de page ni de fil', j(r))
r = await api('POST', '/api/bot/news', { bot, body: art(2) })
ok(r.body?.new === true && r.body?.posted === false, 'sans fil : seulement la page Actualités', j(r))
ok((await api('POST', '/api/bot/news', { bot, body: art(3, { post_id: otherPostId }) })).status === 403, 'fil d’un autre serveur refusé')

const thread = (await api('GET', `/api/servers/${srv.id}/channels/${forum.id}/posts/${postId}`, { token: owner })).body
const replies = thread?.replies ?? thread?.post?.replies ?? []
ok(replies.length === 1 && /\*\*Article 1\*\*/.test(replies[0]?.content ?? '') && /presse-citron\.net\/a1\//.test(replies[0]?.content ?? ''), 'réponse du bot : titre, résumé et lien', j(replies))

const sites = (await api('GET', '/api/news', { token: reader })).body?.sites ?? []
const site = sites.find(s => s.name === 'Presse Citron')
ok(site?.category === 'Informatique' && site?.today >= 2, 'page Actualités : site listé pour un autre compte', j(sites))
const list = (await api('GET', `/api/news/sites/${site?.id}/articles`, { token: reader })).body?.articles ?? []
ok(list.length >= 2 && list[0].title === 'Article 1' && list[0].image?.startsWith('https://'), 'articles du site, du plus récent au plus ancien', j(list))
ok((await api('GET', '/api/news')).status === 401, 'page Actualités réservée aux comptes connectés')

await api('POST', '/api/bot/news', { bot, body: { ...art(4), site: 'Torr9 : Film', public: false } })
const after = (await api('GET', '/api/news', { token: reader })).body?.sites ?? []
ok(!after.some(s => s.name === 'Torr9 : Film'), 'site non public absent de la page')

console.log(failed ? `\n${failed} échec(s)` : '\nTout est vert')
process.exit(failed ? 1 : 0)
