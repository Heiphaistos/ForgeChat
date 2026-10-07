// Types minimaux de transformers.js 4.3.1 (Apache-2.0, https://github.com/huggingface/transformers.js),
// fichier transformers.min.js recopié tel quel depuis le paquet npm @huggingface/transformers@4.3.1
// (dist/transformers.min.js, sha256 8d6716d9086f57c30a4bf367dba61b887593573c770c454465e8019b2703e743).
// Il embarque onnxruntime-web (MIT, https://github.com/microsoft/onnxruntime).
// Seules les parties utilisées par src/ai/engine.worker.ts sont décrites.
export interface OrtWasmEnv {
  wasmPaths?: string | { wasm?: string; mjs?: string }
  wasmBinary?: ArrayBuffer | Uint8Array
  numThreads?: number
  proxy?: boolean
}
export const env: {
  allowLocalModels: boolean
  allowRemoteModels: boolean
  remoteHost: string
  remotePathTemplate: string
  useBrowserCache: boolean
  useFSCache: boolean
  useCustomCache: boolean
  useWasmCache: boolean
  fetch: (url: string | URL, init?: RequestInit) => Promise<Response>
  backends: { onnx: { wasm: OrtWasmEnv } }
}
export class Tensor {
  constructor(type: 'int64', data: BigInt64Array, dims: number[])
  data: ArrayLike<number | bigint>
  dims: number[]
}
export interface Pipe {
  (input: unknown, options?: Record<string, unknown>): Promise<unknown>
  dispose(): Promise<void>
  tokenizer: {
    (text: string, options?: Record<string, unknown>): { input_ids: Tensor }
    get_vocab(): Map<string, number>
    batch_decode(ids: unknown, options?: Record<string, unknown>): string[]
  }
  processor: (audio: Float32Array) => Promise<{ input_features: Tensor }>
  model: {
    (inputs: Record<string, unknown>): Promise<{ logits: Tensor }>
    generate(inputs: Record<string, unknown>): Promise<unknown>
    generation_config: { decoder_start_token_id?: number; lang_to_id?: Record<string, number> }
  }
}
export function pipeline(task: string, model: string, options?: Record<string, unknown>): Promise<Pipe>
