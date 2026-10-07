// Brouillons des conversations, synchronisés entre appareils et chiffrés par une clé
// dérivée de la clé de compte (docs/CHIFFREMENT-E2E.md §14) : le serveur ne range qu'un
// blob opaque. En mémoire sur l'appareil (jamais écrits sur le disque en clair).
import { AppState } from 'react-native'
import { create } from 'zustand'
import { messagingApi } from '@/api/messaging'
import { realtime } from '@/lib/realtime'
import { useAuth } from '@/stores/auth'
import { useAccountKey } from './accountKey'
import * as c from './crypto'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DEBOUNCE_MS = 1500

/** Brouillon par conversation (id du salon, du MP ou du groupe). */
export const useDrafts = create<{ drafts: Record<string, string>; set: (id: string, v: string) => void }>((set) => ({
  drafts: {},
  set: (id, v) => set((s) => ({ drafts: { ...s.drafts, [id]: v } })),
}))

let cached: { tag: string; key: Promise<Uint8Array> } | null = null
const timers = new Map<string, ReturnType<typeof setTimeout>>()
let applying = false

function keyAndUser(): { key: Promise<Uint8Array>; me: string } | null {
  const { priv, pub, status } = useAccountKey.getState()
  const me = useAuth.getState().user?.id
  if (status !== 'ready' || !priv || !pub || !me) return null
  const tag = `${me}|${pub}`
  if (cached?.tag !== tag) cached = { tag, key: c.draftKey(priv, c.b64uDecode(pub), me) }
  return { key: cached.key, me }
}

async function push(convId: string, text: string) {
  timers.delete(convId)
  try {
    if (!text.trim()) return void (await messagingApi.deleteDraft(convId))
    const k = keyAndUser()
    if (k) await messagingApi.putDraft(convId, await c.sealDraft(await k.key, k.me, convId, text))
  } catch { /* hors ligne : le prochain changement repartira */ }
}

function schedule(convId: string, text: string) {
  if (!UUID.test(convId)) return
  clearTimeout(timers.get(convId))
  timers.set(convId, setTimeout(() => void push(convId, text), DEBOUNCE_MS))
}

/** Recharge les brouillons : le serveur fait foi, sauf pour une conversation en cours de frappe. */
export async function pullDrafts() {
  const k = keyAndUser()
  if (!k) return
  try {
    const list = await messagingApi.drafts()
    const key = await k.key
    const next: Record<string, string> = {}
    for (const d of Array.isArray(list) ? list : []) {
      try { next[d.conv_id] = await c.openDraft(key, k.me, d.conv_id, d.blob) } catch { /* autre clé de compte ou altéré */ }
    }
    const local = useDrafts.getState().drafts
    for (const id of timers.keys()) if (local[id] !== undefined) next[id] = local[id]!
    applying = true
    useDrafts.setState({ drafts: next })
    applying = false
  } catch { /* hors ligne */ }
}

/** Synchronisation : changements poussés, rechargement au retour au premier plan et sur DRAFT_UPDATE. */
export function bindDraftSync(): () => void {
  const unsub = useDrafts.subscribe((s, prev) => {
    if (applying || s.drafts === prev.drafts) return
    for (const id of new Set([...Object.keys(s.drafts), ...Object.keys(prev.drafts)])) {
      if (s.drafts[id] !== prev.drafts[id]) schedule(id, s.drafts[id] ?? '')
    }
  })
  let pending: ReturnType<typeof setTimeout> | undefined
  const later = () => {
    clearTimeout(pending)
    pending = setTimeout(() => void pullDrafts(), 500)
  }
  const offKey = useAccountKey.subscribe((s, prev) => { if (s.status === 'ready' && prev.status !== 'ready') later() })
  const offWs = realtime.on('DRAFT_UPDATE', later)
  const app = AppState.addEventListener('change', (st) => { if (st === 'active') later() })
  const offAuth = useAuth.subscribe((s, prev) => {
    // Déconnexion : plus aucun brouillon en mémoire.
    if (prev.user && !s.user) {
      timers.forEach(clearTimeout)
      timers.clear()
      applying = true
      useDrafts.setState({ drafts: {} })
      applying = false
    }
  })
  if (useAccountKey.getState().status === 'ready') later()
  return () => {
    unsub(); offKey(); offWs(); app.remove(); offAuth()
    clearTimeout(pending)
  }
}
