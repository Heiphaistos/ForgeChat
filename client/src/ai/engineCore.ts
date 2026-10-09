// Client du Worker de l'IA sur l'appareil, sans interface : utilisé par l'appli web
// (engine.ts) et par la page moteur de l'appli Android (bridge.ts, ai-engine.html).
import type { AsrPack, Step } from './manifest'
import type { EngineRequest, EngineResponse } from './engine.worker'

let worker: Worker | null = null
let seq = 0
type Result = { text: string; lang?: string }
const pending = new Map<number, { resolve: (r: Result) => void; reject: (e: Error) => void }>()

type Req = EngineRequest extends infer R ? R extends { id: number } ? Omit<R, 'id'> : never : never

function call(req: Req, transfer: Transferable[] = []): Promise<Result> {
  if (!worker) {
    worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<EngineResponse>) => {
      const p = pending.get(e.data.id)
      pending.delete(e.data.id)
      if (!p) return
      if (e.data.ok) p.resolve({ text: e.data.text, lang: e.data.lang })
      else p.reject(new Error(e.data.error))
    }
    worker.onerror = () => stopEngine('worker')
  }
  const id = ++seq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    worker!.postMessage({ ...req, id }, transfer)
  })
}

/** Arrête le moteur et libère la mémoire des modèles (suppression, erreur fatale). */
export function stopEngine(reason = 'stopped') {
  worker?.terminate()
  worker = null
  for (const p of pending.values()) p.reject(new Error(reason))
  pending.clear()
}

export const translateSteps = (text: string, steps: Step[]) => call({ op: 'translate', text, steps }).then(r => r.text)

/** Audio mono 16 kHz → texte et langue parlée (le tampon est transféré au Worker). */
export const transcribePcm = (pcm: Float32Array, language?: string, pack: AsrPack = 'whisper') =>
  call({ op: 'transcribe', pcm, language, pack }, [pcm.buffer])
