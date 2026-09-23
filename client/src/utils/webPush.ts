import api from '../api/client'

// Abonnement Web Push du navigateur (server/src/push.rs). Le serveur ne pousse
// que lorsque l'utilisateur n'a aucune session ouverte ; le service worker
// (public/sw.js) affiche la notification et ouvre le bon salon au clic.
// Indisponible dans l'app de bureau : pas de service worker sous Tauri.

export type WebPushResult = 'ok' | 'denied' | 'unsupported' | 'disabled'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export function webPushSupported(): boolean {
  return !isTauri && typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

function base64UrlToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!webPushSupported()) return null
  const reg = await navigator.serviceWorker.getRegistration()
  return (await reg?.pushManager.getSubscription()) ?? null
}

export async function isWebPushActive(): Promise<boolean> {
  try { return !!(await currentSubscription()) } catch { return false }
}

export async function enableWebPush(): Promise<WebPushResult> {
  if (!webPushSupported()) return 'unsupported'
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return 'unsupported'
  const { data } = await api.get('/push/vapid-public-key')
  if (!data?.enabled || !data.public_key) return 'disabled'
  if ((await Notification.requestPermission()) !== 'granted') return 'denied'
  const sub = (await reg.pushManager.getSubscription())
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(data.public_key) })
  await api.post('/push/subscribe', sub.toJSON())
  return 'ok'
}

export async function disableWebPush(): Promise<void> {
  const sub = await currentSubscription().catch(() => null)
  if (!sub) return
  await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {})
  await sub.unsubscribe().catch(() => false)
}

/** Au démarrage : rattache un abonnement existant au compte connecté. */
export async function syncWebPush(): Promise<void> {
  const sub = await currentSubscription().catch(() => null)
  if (sub && Notification.permission === 'granted') {
    await api.post('/push/subscribe', sub.toJSON()).catch(() => {})
  }
}
