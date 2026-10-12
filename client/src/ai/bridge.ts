// Page moteur de l'appli Android (ai-engine.html, ouverte dans une WebView cachée) :
// même moteur que le web (Worker + WebAssembly), piloté par messages JSON. Le texte et
// l'audio arrivent de l'appli, sont traités ICI sur le téléphone, et le résultat repart
// vers l'appli : rien ne passe par le réseau (seuls les modèles sont téléchargés).
// Tout premier : politique Trusted Types (lib/trustedTypes.ts).
import '../lib/trustedTypes'
import { PACKS, isAiLang, packSize, packsFor, planTranslation, type PackId } from './manifest'
import { downloadPacks, installedPacks, removePacks, usedBytes } from './modelStore'
import { detectLang } from './text'
import { decodeToPcm } from './audio'
import { stopEngine, transcribePcm, translateSteps } from './engineCore'

type Req =
  | { id: number; op: 'status' }
  | { id: number; op: 'download'; packs: PackId[] }
  | { id: number; op: 'remove'; packs: PackId[] }
  | { id: number; op: 'translate'; text: string; target: string }
  | { id: number; op: 'transcribe'; audio: string; mime: string; language?: string; precise?: boolean }

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (s: string) => void }
    fcAi?: (req: Req) => void
  }
}

const BASE = `${location.origin}/ai-models/`
const send = (m: Record<string, unknown>) => window.ReactNativeWebView?.postMessage(JSON.stringify(m))
const known = (ids: unknown): ids is PackId[] => Array.isArray(ids) && ids.every(i => typeof i === 'string' && i in PACKS)

async function missing(ids: PackId[]) {
  const have = await installedPacks()
  const miss = ids.filter(i => !have.has(i))
  return miss.length ? { error: 'missing', packs: miss, size: packSize(miss) } : null
}

async function handle(r: Req): Promise<Record<string, unknown>> {
  switch (r.op) {
    case 'status':
      return {
        installed: [...await installedPacks()],
        used: await usedBytes(),
        sizes: Object.fromEntries((Object.keys(PACKS) as PackId[]).map(id => [id, packSize([id])])),
      }
    case 'download':
      if (!known(r.packs)) return { error: 'bad' }
      await downloadPacks(r.packs, BASE, (done, total) => send({ id: r.id, progress: done / Math.max(total, 1) }))
      return {}
    case 'remove':
      if (!known(r.packs)) return { error: 'bad' }
      stopEngine()
      await removePacks(r.packs)
      return {}
    case 'translate': {
      const src = detectLang(r.text)
      if (!src) return { error: 'lang' }
      if (!isAiLang(r.target)) return { error: 'bad' }
      const steps = planTranslation(src, r.target)
      if (!steps.length) return { error: 'same' }
      return (await missing(packsFor(steps))) ?? { text: await translateSteps(r.text, steps), from: src }
    }
    case 'transcribe': {
      const pack = r.precise === false ? 'whisper' : 'whisper-small'
      const miss = await missing(['runtime', pack])
      if (miss) return miss
      const bytes = Uint8Array.from(atob(r.audio), c => c.charCodeAt(0))
      const pcm = await decodeToPcm(new Blob([bytes], { type: r.mime }))
      return { ...await transcribePcm(pcm, r.language, pack) }
    }
  }
}

window.fcAi = req => {
  handle(req)
    .then(res => send({ id: req.id, ok: !('error' in res), ...res }))
    .catch(e => send({ id: req.id, ok: false, error: 'failed', message: e instanceof Error ? e.message : String(e) }))
}
send({ ready: true })
