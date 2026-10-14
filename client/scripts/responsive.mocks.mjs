// Fausse API pour scripts/responsive.playwright.mjs : juste assez de données pour afficher
// l'appli connectée (serveur, salon, messages, membres, MP, réglages) sans backend.
// Toute route inconnue répond `[]` en GET et `{}` sinon ; le ticket WebSocket est refusé,
// la socket ne s'ouvre donc jamais.

export const ME = '11111111-1111-4111-8111-111111111111'
export const OTHER = '22222222-2222-4222-8222-222222222222'
export const SERVER = '33333333-3333-4333-8333-333333333333'
export const CHANNEL = '44444444-4444-4444-8444-444444444444'
export const VOICE = '55555555-5555-4555-8555-555555555555'
export const DM = '66666666-6666-4666-8666-666666666666'
export const CATEGORY = '77777777-7777-4777-8777-777777777777'
export const GROUP = '88888888-8888-4888-8888-888888888888'

const now = Date.now()
const iso = min => new Date(now - min * 60_000).toISOString()

const user = (id, username) => ({
  id, username, discriminator: '0001', avatar: null, banner: null, bio: 'Bio de test un peu longue pour voir le retour à la ligne sur petit écran.',
  status: 'online', custom_status: null, display_name: username, email: `${username}@test.local`, verified: true, created_at: iso(99999),
})

const me = user(ME, 'momo')
const other = user(OTHER, 'utilisateur_avec_un_pseudo_tres_long')

const server = {
  id: SERVER, name: 'Serveur de test responsive', owner_id: ME, icon: null, banner: null, description: 'Serveur factice', created_at: iso(9999),
}
const channels = [
  { id: CHANNEL, server_id: SERVER, name: 'general-avec-un-nom-de-salon-tres-long', type: 'text', position: 0, category_id: CATEGORY, topic: 'Sujet du salon assez long pour déborder si rien ne le coupe proprement' },
  { id: VOICE, server_id: SERVER, name: 'Vocal', type: 'voice', position: 1, category_id: CATEGORY },
]

const long = 'https://exemple.test/' + 'chemin/'.repeat(30) + 'fin'
const texts = [
  'Salut ! Message court.',
  'Un message plus long qui doit passer à la ligne proprement sur un téléphone de 320 pixels de large sans provoquer de défilement horizontal.',
  `Lien très long sans espace : ${long}`,
  '```\nconst uneLigneDeCodeTresLongueQuiNeDoitPasElargirLaPage = () => console.log("ceci est une ligne de code très longue, très très longue")\n```',
  'motsansespacemotsansespacemotsansespacemotsansespacemotsansespacemotsansespacemotsansespace',
]
const chanMsgs = texts.map((content, i) => ({
  id: `aaaaaaaa-0000-4000-8000-00000000000${i}`, channel_id: CHANNEL, author_id: i % 2 ? OTHER : ME,
  author_username: i % 2 ? other.username : me.username, author_avatar: null, content, created_at: iso(60 - i * 5),
  edited_at: null, reactions: [], attachments: [], pinned: false,
}))
const dmMsgs = texts.map((content, i) => ({
  id: `bbbbbbbb-0000-4000-8000-00000000000${i}`, dm_id: DM, sender_id: i % 2 ? OTHER : ME,
  sender_username: i % 2 ? other.username : me.username, sender_avatar: null, content, created_at: iso(60 - i * 5),
  edited_at: null, reactions: [], attachments: [],
}))
const members = [me, other, ...Array.from({ length: 12 }, (_, i) => user(`99999999-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`, `membre${i}`))]
  .map(u => ({ user_id: u.id, username: u.username, display_name: u.display_name, avatar: null, status: u.status, roles: [], tags: [], nickname: null, joined_at: iso(999) }))

const dms = [{ id: DM, other_user_id: OTHER, username: other.username, avatar: null, status: 'online', last_message_at: iso(1), created_at: iso(999) }]

/** [méthode, motif de chemin, corps] — premier qui correspond gagne. */
const ROUTES = [
  ['GET', /^\/users\/me$/, me],
  ['GET', /^\/users\/me\/keys$/, { public_key: null, wrapped: null }],
  ['GET', /^\/servers$/, [server]],
  ['GET', /^\/servers\/[^/]+$/, { server, channels, roles: [], categories: [{ id: CATEGORY, name: 'Salons textuels', position: 0 }], member: { roles: [] } }],
  ['GET', /^\/servers\/[^/]+\/categories$/, [{ id: CATEGORY, server_id: SERVER, name: 'Salons textuels', position: 0 }]],
  ['GET', /^\/servers\/[^/]+\/members$/, members],
  ['GET', /^\/servers\/[^/]+\/members\/detailed$/, members],
  ['GET', /^\/servers\/[^/]+\/members\/[^/]+$/, members[1]],
  ['GET', /^\/servers\/[^/]+\/channels\/[^/]+\/messages$/, chanMsgs],
  ['GET', /^\/dms\/groups\/[^/]+$/, {
    id: GROUP, name: 'Groupe de discussion au nom assez long', owner_id: ME, call_participants: [],
    members: members.slice(0, 4).map(m => ({ id: m.user_id, username: m.username, avatar: null, status: 'online' })),
  }],
  ['GET', /^\/dms\/groups\/[^/]+\/messages$/, dmMsgs.map(m => ({ ...m, group_id: GROUP }))],
  ['GET', /^\/dms$/, dms],
  ['GET', /^\/dms\/[^/]+\/messages$/, dmMsgs],
  ['GET', /^\/users\/[^/]+\/social$/, { in_call: false, badges: ['age_1y', 'msg_1k'], birthday: null }],
  ['GET', /^\/users\/[^/]+\/profile$/, { user: other, mutual_servers: [], mutual_friends: [] }],
  ['GET', /^\/users\/[^/]+$/, other],
  ['GET', /^\/friends$/, [{ id: OTHER, user_id: OTHER, username: other.username, avatar: null, status: 'online' }]],
  ['GET', /^\/user\/settings$/, { theme: 'dark', locale: 'fr' }],
  ['GET', /^\/unread$/, { channels: [], dms: [] }],
  ['POST', /^\/auth\/ws-ticket$/, null, 404],
]

/**
 * Branche la fausse API sur un contexte Playwright. `misses` collecte les routes non prévues
 * (débogage). Renvoie un état : `state.logged = false` → visiteur (session refusée en 401).
 */
export async function mockApi(ctx, misses = new Set()) {
  const state = { logged: true }
  // Chemin qui COMMENCE par /api/ : en dev, Vite sert aussi /src/api/*.ts.
  await ctx.route(u => u.pathname.startsWith('/api/'), route => {
    const req = route.request()
    const path = new URL(req.url()).pathname.replace(/^\/api/, '')
    const method = req.method()
    if (!state.logged && (path === '/users/me' || path.startsWith('/auth/'))) {
      return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthorized"}' })
    }
    const hit = ROUTES.find(([m, re]) => m === method && re.test(path))
    if (!hit) misses.add(`${method} ${path}`)
    const [, , body, status = 200] = hit ?? [method, null, method === 'GET' ? [] : {}]
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body ?? {}) })
  })
  // Pas de socket : rien ne doit attendre le serveur temps réel.
  await ctx.route(u => u.pathname === '/ws', route => route.abort())
  await ctx.addInitScript(() => {
    localStorage.setItem('fc_onboarding_done', 'true')
  })
  return state
}
