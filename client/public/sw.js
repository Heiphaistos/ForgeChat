/* Service worker minimal ForgeChat.
   Stratégie volontairement conservatrice :
   - cache-first UNIQUEMENT sur les assets Vite hashés (/assets/*) et les
     icônes — immutables par construction, aucun risque de version périmée
   - tout le reste (index.html, /api, /ws, /uploads, manifest) passe au
     réseau sans jamais être mis en cache : l'app se met à jour normalement */

const CACHE = 'fc-assets-v1'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return

  const isImmutableAsset =
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/icon.svg'

  if (!isImmutableAsset) return // réseau direct, pas d'interception

  e.respondWith(
    caches.match(e.request).then(hit =>
      hit ?? fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone()
          caches.open(CACHE).then(c => c.put(e.request, clone))
        }
        return res
      })
    )
  )
})

// ─── Web Push (server/src/push.rs) ───────────────────────────────────────────
// Charge utile JSON : { title, body, url, tag }. Envoyée seulement quand
// l'utilisateur n'a aucune session ouverte : on l'affiche toujours.
self.addEventListener('push', (e) => {
  let data = {}
  try { data = e.data ? e.data.json() : {} } catch { data = { body: e.data ? e.data.text() : '' } }
  e.waitUntil(
    self.registration.showNotification(data.title || 'ForgeChat', {
      body: data.body || '',
      icon: '/icon.svg',
      badge: '/icon.svg',
      tag: data.tag ? String(data.tag) : undefined,
      data: { url: typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/' },
    })
  )
})

// Clic : réutiliser un onglet ForgeChat ouvert (focus + navigation), sinon en ouvrir un.
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => new URL(w.url).origin === self.location.origin)
      if (win) return win.focus().then((w) => (w || win).navigate(url)).catch(() => self.clients.openWindow(url))
      return self.clients.openWindow(url)
    })
  )
})
