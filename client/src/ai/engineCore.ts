// Client du Worker de l'IA sur l'appareil, sans interface : utilisé par l'appli web
// (engine.ts) et par la page moteur de l'appli Android (bridge.ts, ai-engine.html).
import type { AsrPack, Step } from './manifest'
import type { EngineRequest, EngineResponse } from './engine.worker'
import workerUrl from './engine.worker.ts?worker&url'

let worker: Promise<Worker> | null = null
let seq = 0
type Result = { text: string; lang?: string }
const pending = new Map<number, { resolve: (r: Result) => void; reject: (e: Error) => void }>()

type Req = EngineRequest extends infer R ? R extends { id: number } ? Omit<R, 'id'> : never : never

// Appli Android : l'appli a vérifié le Worker et pose son empreinte dans la page (mobile engineIntegrity.ts).
// Il est alors relu avec `integrity` et lancé depuis ce blob : un serveur ne peut pas servir à la WebView
// un autre Worker que celui que l'appli a contrôlé.
async function spawn(): Promise<Worker> {
  const url = new URL(workerUrl, location.href)
  const sri = typeof document === 'undefined' ? null : document.querySelector<HTMLMetaElement>('meta[name="fc-worker-integrity"]')?.content
  if (!sri) return new Worker(url, { type: 'module' })
  const r = await fetch(url, { integrity: sri, credentials: 'omit' })
  if (!r.ok) throw new Error(`worker ${r.status}`)
  return new Worker(URL.createObjectURL(await r.blob()), { type: 'module' })
}

function call(req: Req, transfer: Transferable[] = []): Promise<Result> {
  const w = worker ??= spawn().then(w => {
    w.onmessage = (e: MessageEvent<EngineResponse>) => {
      const p = pending.get(e.data.id)
      pending.delete(e.data.id)
      if (!p) return
      if (e.data.ok) p.resolve({ text: e.data.text, lang: e.data.lang })
      else p.reject(new Error(e.data.error))
    }
    w.onerror = () => stopEngine('worker')
    return w
  })
  const id = ++seq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.then(w => w.postMessage({ ...req, id }, transfer), (e: Error) => {
      if (worker === w) worker = null
      pending.delete(id)
      reject(e)
    })
  })
}

/** Arrête le moteur et libère la mémoire des modèles (suppression, erreur fatale). */
export function stopEngine(reason = 'stopped') {
  void worker?.then(w => w.terminate(), () => {})
  worker = null
  for (const p of pending.values()) p.reject(new Error(reason))
  pending.clear()
}

export const translateSteps = (text: string, steps: Step[]) => call({ op: 'translate', text, steps }).then(r => r.text)

/** Audio mono 16 kHz → texte et langue parlée (le tampon est transféré au Worker). */
export const transcribePcm = (pcm: Float32Array, language?: string, pack: AsrPack = 'whisper') =>
  call({ op: 'transcribe', pcm, language, pack }, [pcm.buffer])
