/// <reference lib="webworker" />
// Moteur de l'IA sur l'appareil, dans un Worker pour ne jamais bloquer l'interface.
// transformers.js (copie locale, src/ai/third-party) + onnxruntime-web en WebAssembly.
// AUCUN accès réseau ici : chaque fichier vient du stockage local, vérifié par SHA-256.
import { env, pipeline, Tensor, type Pipe } from './third-party/transformers.min.js'
import { AI_LANGS, PACKS, fileByPath, type PackId, type Step } from './manifest.ts'
import { readVerified } from './modelStore.ts'
import { chunkLine, needsTranslation } from './text.ts'
import { RATE, collapseRepeats, looped, splitOnPauses } from './audio.ts'

// Hôte fictif : transformers.js construit `<hôte><repo>/<fichier>`, que env.fetch sert
// depuis le stockage local. Une requête hors manifeste reçoit un 404, jamais le réseau.
const HOST = 'https://forgechat-ai.invalid/'

let ready: Promise<void> | null = null
function setup() {
  ready ??= (async () => {
    env.allowLocalModels = false
    env.allowRemoteModels = true
    env.useBrowserCache = false
    env.useFSCache = false
    env.useCustomCache = false
    env.useWasmCache = false
    env.remoteHost = HOST
    env.remotePathTemplate = '{model}/'
    env.fetch = async (url) => {
      const f = fileByPath(String(url).slice(HOST.length))
      if (!f) return new Response(null, { status: 404 })
      const data = await readVerified(f)
      return new Response(data, { status: 200, headers: { 'content-length': String(data.byteLength) } })
    }
    const wasm = env.backends.onnx.wasm
    wasm.wasmBinary = await readVerified(PACKS.runtime.files[0])
    // Fabrique WebAssembly incluse dans le paquet : seul le binaire vérifié est fourni.
    wasm.wasmPaths = { wasm: HOST + 'ort.wasm' }
    wasm.numThreads = 1
    wasm.proxy = false
  })()
  return ready
}

// Modèles chargés : au plus deux de traduction en mémoire (~250 Mo chacun en RAM).
const loaded = new Map<PackId, Promise<Pipe>>()
async function pipe(id: PackId): Promise<Pipe> {
  await setup()
  let p = loaded.get(id)
  if (!p) {
    const task = id === 'whisper' ? 'automatic-speech-recognition' : 'translation'
    p = pipeline(task, PACKS[id].repo!, { dtype: 'q8', device: 'wasm' })
    p.catch(() => loaded.delete(id))
    loaded.set(id, p)
    const translators = [...loaded.keys()].filter(k => k !== 'whisper')
    if (translators.length > 2) {
      const old = translators[0]
      const o = loaded.get(old)
      loaded.delete(old)
      void o?.then(x => x.dispose()).catch(() => {})
    }
  }
  return p
}

const int64 = (ids: bigint[]) => new Tensor('int64', BigInt64Array.from(ids), [1, ids.length])

/**
 * Une phrase traduite. Modèle multi-cible (en-ROMANCE) : le jeton de langue `>>fr<<`
 * est ajouté à la main en tête, le tokenizer de transformers.js 4.3 ne le reconnaissant
 * plus dans le texte (il le découpait en caractères et le modèle choisissait la langue).
 */
async function translateOne(p: Pipe, text: string, prefix: string): Promise<string> {
  if (!prefix) {
    const r = await p(text, { max_new_tokens: 512 }) as { translation_text: string }[]
    return r[0]?.translation_text ?? text
  }
  const lang = p.tokenizer.get_vocab().get(prefix.trim())
  if (lang === undefined) throw new Error(`langue ${prefix}`)
  const ids = [BigInt(lang), ...Array.from(p.tokenizer(text).input_ids.data, BigInt)]
  const out = await p.model.generate({ input_ids: int64(ids), attention_mask: int64(ids.map(() => 1n)), max_new_tokens: 512 })
  return p.tokenizer.batch_decode(out, { skip_special_tokens: true })[0]?.trim() ?? text
}

/**
 * Langue parlée parmi fr/en/es/de/it/pt : premier pas du décodeur de Whisper (jeton de
 * langue le plus probable). transformers.js imposerait sinon l'anglais, et Whisper
 * TRADUIRAIT alors un message vocal français au lieu de le transcrire.
 */
async function spokenLang(asr: Pipe, pcm: Float32Array): Promise<string> {
  const gc = asr.model.generation_config
  const { input_features } = await asr.processor(pcm.subarray(0, 30 * 16000))
  const { logits } = await asr.model({ input_features, decoder_input_ids: int64([BigInt(gc.decoder_start_token_id ?? 50258)]) })
  const row = logits.data as Float32Array
  const off = row.length - logits.dims[logits.dims.length - 1]
  let best: string = 'en'
  let top = -Infinity
  for (const l of AI_LANGS) {
    const id = gc.lang_to_id?.[`<|${l}|>`]
    if (id !== undefined && row[off + id] > top) { top = row[off + id]; best = l }
  }
  return best
}

async function translateText(text: string, steps: Step[]): Promise<string> {
  const lines = text.split('\n')
  const out: string[] = []
  for (const line of lines) {
    if (!needsTranslation(line)) { out.push(line); continue }
    const parts: string[] = []
    for (const chunk of chunkLine(line)) {
      let cur = chunk
      for (const s of steps) cur = await translateOne(await pipe(s.pack), cur, s.prefix)
      parts.push(cur)
    }
    out.push(parts.join(' '))
  }
  return out.join('\n')
}

async function transcribe(pcm: Float32Array, language?: string): Promise<{ text: string; lang: string }> {
  const asr = await pipe('whisper')
  const lang = language ?? await spokenLang(asr, pcm)
  const parts: string[] = []
  for (const seg of splitOnPauses(pcm)) {
    // Au plus ~8 jetons par seconde de parole : une boucle s'arrête là au lieu de remplir la fenêtre.
    const opts = { task: 'transcribe', language: lang, max_new_tokens: Math.min(440, Math.ceil(seg.length / RATE * 8) + 16) }
    let text = (await asr(seg, opts) as { text: string }).text.trim()
    // Morceau qui a bouclé : second essai où un même groupe de 3 jetons ne peut plus revenir.
    if (looped(text)) text = (await asr(seg, { ...opts, no_repeat_ngram_size: 3 }) as { text: string }).text.trim()
    parts.push(text)
  }
  return { text: collapseRepeats(parts.join(' ')).trim(), lang }
}

export type EngineRequest =
  | { id: number; op: 'translate'; text: string; steps: Step[] }
  | { id: number; op: 'transcribe'; pcm: Float32Array; language?: string }
export type EngineResponse = { id: number; ok: true; text: string; lang?: string } | { id: number; ok: false; error: string }

self.onmessage = async (e: MessageEvent<EngineRequest>) => {
  const m = e.data
  try {
    const res = m.op === 'translate' ? { text: await translateText(m.text, m.steps) } : await transcribe(m.pcm, m.language)
    self.postMessage({ id: m.id, ok: true, ...res } satisfies EngineResponse)
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies EngineResponse)
  }
}
