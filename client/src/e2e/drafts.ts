// Brouillons synchronisés entre appareils (docs/CHIFFREMENT-E2E.md §14).
// Chiffrés ici par une clé dérivée de la clé de compte : le serveur ne range qu'un
// blob opaque par conversation. Le magasin local (`useDraft`) reste la source de
// l'affichage ; ce module le pousse (différé) et le recharge (démarrage, retour sur
// l'onglet, DRAFT_UPDATE d'un autre appareil).
import api from '../api/client'
import { useAuth } from '../store/auth'
import { useDraft } from '../store/chat'
import { useAccountKey } from './accountKey'
import * as c from './crypto'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DEBOUNCE_MS = 1500
/** Brouillons locaux d'avant la synchronisation : envoyés une fois au lieu d'être écrasés. */
const MIGRATED = 'fc-drafts-synced'

let cachedKey: { tag: string; key: Promise<Uint8Array> } | null = null
const timers = new Map<string, ReturnType<typeof setTimeout>>()
let applying = false

function keyAndUser(): { key: Promise<Uint8Array>; me: string } | null {
  const { priv, pub, status } = useAccountKey.getState()
  const me = useAuth.getState().user?.id
  if (status !== 'ready' || !priv || !pub || !me) return null
  const tag = `${me}|${pub}`
  if (cachedKey?.tag !== tag) cachedKey = { tag, key: c.draftKey(priv, c.b64uDecode(pub), me) }
  return { key: cachedKey.key, me }
}

async function push(convId: string, text: string) {
  timers.delete(convId)
  try {
    if (!text.trim()) {
      await api.delete(`/drafts/${convId}`)
      return
    }
    const k = keyAndUser()
    if (!k) return
    await api.put(`/drafts/${convId}`, await c.sealDraft(await k.key, k.me, convId, text))
  } catch { /* hors ligne ou limite atteinte : le prochain changement repartira */ }
}

/** Envoi différé du brouillon de `convId` (chiffré), ou effacement s'il est vide. */
function schedule(convId: string, text: string) {
  if (!UUID.test(convId)) return
  clearTimeout(timers.get(convId))
  timers.set(convId, setTimeout(() => void push(convId, text), DEBOUNCE_MS))
}

/** Brouillons du serveur, déchiffrés (les illisibles sont ignorés). */
async function fetchRemote(): Promise<Record<string, string> | null> {
  const k = keyAndUser()
  if (!k) return null
  const { data } = await api.get<{ conv_id: string; blob: c.DraftBlob }[]>('/drafts')
  const key = await k.key
  const out: Record<string, string> = {}
  for (const d of data) {
    try { out[d.conv_id] = await c.openDraft(key, k.me, d.conv_id, d.blob) } catch { /* autre clé de compte ou altéré */ }
  }
  return out
}

/** Recharge les brouillons : le serveur fait foi, sauf pour une conversation en cours de frappe. */
export async function pullDrafts() {
  const remote = await fetchRemote().catch(() => null)
  if (!remote) return
  const local = useDraft.getState().drafts
  let migrate = false
  try { migrate = localStorage.getItem(MIGRATED) !== '1' } catch { /* stockage indisponible */ }
  const next: Record<string, string> = { ...remote }
  for (const [id, text] of Object.entries(local)) {
    if (timers.has(id) || (migrate && !(id in remote))) {
      next[id] = text
      if (migrate && !timers.has(id)) schedule(id, text)
    }
  }
  try { localStorage.setItem(MIGRATED, '1') } catch { /* idem */ }
  applying = true
  useDraft.setState({ drafts: next })
  applying = false
}

/**
 * Suit les changements du magasin de brouillons et les pousse ; recharge au démarrage,
 * au retour sur l'onglet et sur DRAFT_UPDATE. Renvoie la fonction d'arrêt.
 */
export function startDraftSync(on: (type: string, h: (d: unknown) => void) => () => void): () => void {
  void pullDrafts()
  const unsub = useDraft.subscribe((s, prev) => {
    if (applying || s.drafts === prev.drafts) return
    for (const id of new Set([...Object.keys(s.drafts), ...Object.keys(prev.drafts)])) {
      if (s.drafts[id] !== prev.drafts[id]) schedule(id, s.drafts[id] ?? '')
    }
  })
  let pending: ReturnType<typeof setTimeout> | undefined
  const later = () => { clearTimeout(pending); pending = setTimeout(() => void pullDrafts(), 500) }
  const offWs = on('DRAFT_UPDATE', later)
  const onVisible = () => { if (document.visibilityState === 'visible') later() }
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    unsub()
    offWs()
    clearTimeout(pending)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
