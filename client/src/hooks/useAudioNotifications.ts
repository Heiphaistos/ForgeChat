import { useState, useCallback } from 'react'
import { streamerHides } from '../lib/uxPrefs'
import { avPrefs } from '../lib/avPrefs'

// ── AudioContext singleton ────────────────────────────────────────────────────
let _ctx: AudioContext | null = null

function getCtx(): AudioContext {
  if (!_ctx || _ctx.state === 'closed') {
    _ctx = new AudioContext()
  }
  if (_ctx.state === 'suspended') {
    _ctx.resume().catch(() => {})
  }
  return _ctx
}

// Volume des sons de l'interface (Réglages > Voix > Sons de l'interface) : un nœud de
// sortie commun, mis à jour à chaque son.
let _out: { ctx: AudioContext; gain: GainNode } | null = null

function sfxOut(ctx: AudioContext): GainNode {
  if (!_out || _out.ctx !== ctx) {
    const gain = ctx.createGain()
    gain.connect(ctx.destination)
    _out = { ctx, gain }
  }
  _out.gain.gain.value = avPrefs().sfxVolume / 100
  return _out.gain
}

// ── Synthèse sonore ──────────────────────────────────────────────────────────
function playTone(
  frequency: number,
  endFrequency: number,
  duration: number,
  gainValue: number = 0.15,
): void {
  const ctx = getCtx()
  const gain = ctx.createGain()
  gain.connect(sfxOut(ctx))
  gain.gain.setValueAtTime(gainValue, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration)

  const osc = ctx.createOscillator()
  osc.connect(gain)
  osc.type = 'sine'
  osc.frequency.setValueAtTime(frequency, ctx.currentTime)
  if (endFrequency !== frequency) {
    osc.frequency.exponentialRampToValueAtTime(endFrequency, ctx.currentTime + duration)
  }
  osc.start(ctx.currentTime)
  osc.stop(ctx.currentTime + duration)
}

function playDoubleBip(freq1: number, freq2: number, duration: number): void {
  const ctx = getCtx()

  // Premier bip
  const gain1 = ctx.createGain()
  gain1.connect(sfxOut(ctx))
  gain1.gain.setValueAtTime(0.15, ctx.currentTime)
  gain1.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration)

  const osc1 = ctx.createOscillator()
  osc1.connect(gain1)
  osc1.type = 'sine'
  osc1.frequency.setValueAtTime(freq1, ctx.currentTime)
  osc1.start(ctx.currentTime)
  osc1.stop(ctx.currentTime + duration)

  // Deuxième bip (décalé)
  const t2 = ctx.currentTime + duration + 0.05
  const gain2 = ctx.createGain()
  gain2.connect(sfxOut(ctx))
  gain2.gain.setValueAtTime(0.15, t2)
  gain2.gain.exponentialRampToValueAtTime(0.0001, t2 + duration)

  const osc2 = ctx.createOscillator()
  osc2.connect(gain2)
  osc2.type = 'sine'
  osc2.frequency.setValueAtTime(freq2, t2)
  osc2.start(t2)
  osc2.stop(t2 + duration)
}

/** Réglages > Voix > Sons de l'interface : aperçu au volume choisi (même si les sons sont coupés). */
export const previewUiSound = () => playDoubleBip(880, 1100, 0.2)

// Vérification centralisée depuis localStorage pour éviter les états désynchronisés
function isEnabled(): boolean {
  if (streamerHides('smSounds')) return false
  const stored = localStorage.getItem('audio_notif_enabled')
  return stored === null ? true : stored === 'true'
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useAudioNotifications() {
  const [enabled, setEnabled] = useState<boolean>(isEnabled)

  const handleSetEnabled = useCallback((value: boolean) => {
    localStorage.setItem('audio_notif_enabled', String(value))
    setEnabled(value)
  }, [])

  // Les callbacks lisent toujours localStorage directement — pas la closure stale
  const playJoin = useCallback(() => {
    if (!isEnabled()) return
    playTone(220, 440, 0.3)
  }, [])

  const playLeave = useCallback(() => {
    if (!isEnabled()) return
    playTone(440, 220, 0.3)
  }, [])

  const playMessage = useCallback(() => {
    if (!isEnabled()) return
    playTone(800, 800, 0.05, 0.1)
  }, [])

  const playMention = useCallback(() => {
    if (!isEnabled()) return
    playDoubleBip(880, 1100, 0.2)
  }, [])

  const playRing = useCallback(() => {
    if (!isEnabled()) return
    const ctx = getCtx()
    const schedule = (offset: number) => {
      const g = ctx.createGain()
      g.connect(sfxOut(ctx))
      g.gain.setValueAtTime(0, ctx.currentTime + offset)
      g.gain.linearRampToValueAtTime(0.2, ctx.currentTime + offset + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.18)
      const osc = ctx.createOscillator()
      osc.connect(g)
      osc.type = 'sine'
      osc.frequency.setValueAtTime(880, ctx.currentTime + offset)
      osc.frequency.linearRampToValueAtTime(1100, ctx.currentTime + offset + 0.18)
      osc.start(ctx.currentTime + offset)
      osc.stop(ctx.currentTime + offset + 0.2)
    }
    schedule(0); schedule(0.25); schedule(0.5)
  }, [])

  // Tonalité de retour d'appel côté appelant (style tonalité française : 440 Hz doux)
  const playRingback = useCallback(() => {
    if (!isEnabled()) return
    playTone(440, 440, 0.8, 0.08)
  }, [])

  return { playJoin, playLeave, playMessage, playMention, playRing, playRingback, enabled, setEnabled: handleSetEnabled }
}
