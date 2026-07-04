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
