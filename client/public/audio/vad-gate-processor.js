// Seuil de sensibilité du micro (Réglages > Voix > Sensibilité d'entrée), dans le
// fil audio : en dessous du seuil (dBFS, RMS par bloc de 128 échantillons), le
// micro transmet du silence ; au-dessus, il s'ouvre aussitôt et reste ouvert
// `holdMs` après la dernière syllabe. Seuil et maintien se règlent à chaud par
// `port.postMessage({ threshold, holdMs })`, sans reconstruire la chaîne.
class FcVadGate extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const o = (options && options.processorOptions) || {}
    this.threshold = typeof o.threshold === 'number' ? o.threshold : -50
    this.holdMs = typeof o.holdMs === 'number' ? o.holdMs : 250
    this.hold = 0
    this.gain = 0
    // Ouverture en ~2 ms, fermeture en ~25 ms : pas de clic, pas de syllabe mangée.
    this.attack = 1 - Math.exp(-1 / (0.002 * sampleRate))
    this.release = 1 - Math.exp(-1 / (0.025 * sampleRate))
    this.port.onmessage = (e) => {
      const d = e.data || {}
      if (typeof d.threshold === 'number') this.threshold = d.threshold
      if (typeof d.holdMs === 'number') this.holdMs = d.holdMs
    }
  }

  process(inputs, outputs) {
    const input = inputs[0]
    const output = outputs[0]
    if (!output || output.length === 0) return true
    if (!input || input.length === 0 || !input[0]) {
      for (const ch of output) ch.fill(0)
      return true
    }
    const first = input[0]
    let sum = 0
    for (let i = 0; i < first.length; i++) sum += first[i] * first[i]
    const db = 20 * Math.log10(Math.sqrt(sum / first.length) + 1e-10)
    if (db >= this.threshold) this.hold = (this.holdMs / 1000) * sampleRate
    else this.hold -= first.length
    const target = this.hold > 0 ? 1 : 0
    const coef = target > this.gain ? this.attack : this.release
    let g = this.gain
    for (let i = 0; i < first.length; i++) {
      g += (target - g) * coef
      for (let c = 0; c < output.length; c++) {
        const src = input[c] || first
        output[c][i] = src[i] * g
      }
    }
    this.gain = g
    return true
  }
}

registerProcessor('fc-vad-gate', FcVadGate)
