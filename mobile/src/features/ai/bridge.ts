// Pont vers le moteur d'IA sur l'appareil : la page `<serveur>/ai-engine.html` (même code
// que le web, client/src/ai/bridge.ts) tourne dans une WebView CACHÉE de l'appli. Le texte
// et l'audio lui sont passés en mémoire et traités sur le téléphone (WebAssembly) ; rien ne
// part sur le réseau à part le téléchargement des modèles, vérifiés par SHA-256.
import { create } from 'zustand'

export type PackId = 'runtime' | 'whisper' | 'whisper-small' | 'romance-en' | 'en-romance' | 'de-en' | 'en-de'
export const ALL_PACKS: PackId[] = ['runtime', 'whisper', 'whisper-small', 'romance-en', 'en-romance', 'de-en', 'en-de']

export interface AiReply {
  id?: number
  ok?: boolean
  error?: 'missing' | 'lang' | 'same' | 'bad' | 'failed' | 'engine'
  packs?: PackId[]
  size?: number
  text?: string
  installed?: PackId[]
  sizes?: Partial<Record<PackId, number>>
  used?: number
  progress?: number
  ready?: boolean
}

interface HostState {
  /** WebView montée (seulement après la première demande : rien n'est chargé avant). */
  active: boolean
  /** Téléchargement des modèles en cours (0..1), sinon null. */
  progress: number | null
}
export const useAiHost = create<HostState>(() => ({ active: false, progress: null }))

let inject: ((js: string) => void) | null = null
let markReady: () => void = () => {}
let ready = new Promise<void>((r) => (markReady = r))
let seq = 0
const pending = new Map<number, { resolve: (r: AiReply) => void; onProgress?: (p: number) => void }>()

/** Appelé par AiEngineHost quand la WebView est montée / démontée ou plantée. */
export function attach(fn: ((js: string) => void) | null) {
  inject = fn
  if (fn) return
  ready = new Promise<void>((r) => (markReady = r))
  for (const p of pending.values()) p.resolve({ ok: false, error: 'engine' })
  pending.clear()
}

export function onEngineMessage(data: string) {
  let m: AiReply
  try {
    m = JSON.parse(data) as AiReply
  } catch {
    return
  }
  if (m.ready) return markReady()
  if (typeof m.id !== 'number') return
  const p = pending.get(m.id)
  if (!p) return
  if (typeof m.progress === 'number') return p.onProgress?.(m.progress)
  pending.delete(m.id)
  p.resolve(m)
}

function timeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([p, new Promise<T>((r) => (timer = setTimeout(() => r(fallback), ms)))]).finally(() => clearTimeout(timer))
}

/** Requête au moteur. Ne lève jamais : `{ ok: false, error }` en cas d'échec. */
export async function aiCall(req: Record<string, unknown> & { op: string }, onProgress?: (p: number) => void): Promise<AiReply> {
  useAiHost.setState({ active: true })
  const up = await timeout(ready.then(() => true), 30_000, false)
  if (!up || !inject) return { ok: false, error: 'engine' }
  const id = ++seq
  const reply = new Promise<AiReply>((resolve) => pending.set(id, { resolve, onProgress }))
  inject(`window.fcAi && window.fcAi(${JSON.stringify({ ...req, id })});true;`)
  return reply
}

/** Téléchargement avec barre de progression globale (AiEngineHost). */
export async function downloadPacks(packs: PackId[]): Promise<boolean> {
  useAiHost.setState({ progress: 0 })
  try {
    const r = await aiCall({ op: 'download', packs }, (p) => useAiHost.setState({ progress: p }))
    return !!r.ok
  } finally {
    useAiHost.setState({ progress: null })
  }
}
