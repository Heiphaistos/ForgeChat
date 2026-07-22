// Noise gate/expander — atténue le bruit de fond en dessous d'un seuil RMS.
// Complète highpass/lowpass/compressor (voice.ts _buildNoiseChain) : le compressor
// réduit les pics forts mais ne coupe pas le bruit constant sous le seuil de parole
// (ventilateur, clim, hum électrique). Ce gate attaque/relâche en douceur pour éviter
// les artefacts de coupure ("clics") pendant les silences entre les mots.
class NoiseGateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: 0.02, minValue: 0, maxValue: 1 },
      { name: 'attack', defaultValue: 0.01, minValue: 0.001, maxValue: 1 },
      { name: 'release', defaultValue: 0.15, minValue: 0.001, maxValue: 2 },
      { name: 'floor', defaultValue: 0.08, minValue: 0, maxValue: 1 },
    ]
  }

  constructor() {
    super()
    this._envelope = 0
    this._gain = 1
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0]
    const output = outputs[0]
    if (!input || input.length === 0) return true

    const threshold = parameters.threshold[0]
    const attack = parameters.attack[0]
    const release = parameters.release[0]
    const floor = parameters.floor[0]
    const sr = sampleRate

    const attackCoeff = Math.exp(-1 / (sr * attack))
    const releaseCoeff = Math.exp(-1 / (sr * release))

    for (let ch = 0; ch < input.length; ch++) {
      const inCh = input[ch]
      const outCh = output[ch]
      if (!inCh || !outCh) continue
      for (let i = 0; i < inCh.length; i++) {
        const sample = inCh[i]
        // Enveloppe RMS lissée
        this._envelope = this._envelope * 0.99 + Math.abs(sample) * 0.01
        const targetGain = this._envelope >= threshold ? 1 : floor
        const coeff = targetGain < this._gain ? releaseCoeff : attackCoeff
        this._gain = targetGain + (this._gain - targetGain) * coeff
        outCh[i] = sample * this._gain
      }
    }
    return true
  }
}

registerProcessor('noise-gate-processor', NoiseGateProcessor)
