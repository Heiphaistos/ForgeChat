import { useEffect, useMemo, useRef, useState } from 'react'
import { attachMeter, subscribeLevels, SPEAKING_THRESHOLD } from '../lib/audio'

// Détection de parole. Tous les analyseurs vivent sur l'AudioContext partagé de
// lib/audio.ts et sont échantillonnés par UNE seule boucle : chaque hook créait
// avant son propre AudioContext (jusqu'à 2 + N + 3 sur une page d'appel), au-delà
// de la limite de 6 de Chrome — les indicateurs se figeaient en silence dès ~3
// pairs. Le seuil est lui aussi unique, sinon l'anneau de la tuile et la barre
// d'activité ne s'allumaient pas au même moment.

/** Niveaux (0-255) par pair, mis à jour 10 fois par seconde. */
export function usePeersVoiceActivity(peers: { userId: string; stream: MediaStream | null }[]): Record<string, number> {
  const [levels, setLevels] = useState<Record<string, number>>({})
  const keys = useMemo(
    () => peers.filter(p => p.stream).map(p => `${p.userId}:${p.stream!.id}`).join('|'),
    [peers],
  )

  useEffect(() => {
    const detach = peers
      .filter(p => p.stream)
      .map(p => attachMeter(p.userId, p.stream))
    return () => detach.forEach(fn => fn())
    // `keys` capture l'identité réelle des flux ; `peers` est un tableau recréé à
    // chaque render, s'en servir comme dépendance relançait l'effet 12 fois par
    // seconde.
     
  }, [keys])

  useEffect(() => subscribeLevels((map) => {
    const next: Record<string, number> = {}
    map.forEach((v, k) => { next[k] = v })
    setLevels(prev => {
      const sameLength = Object.keys(prev).length === Object.keys(next).length
      if (sameLength && Object.keys(next).every(k => prev[k] === next[k])) return prev
      return next
    })
  }), [])

  return levels
}

/** `true` tant que le flux dépasse le seuil de parole. */
export function useVoiceActivity(stream: MediaStream | null, enabled = true): boolean {
  const [speaking, setSpeaking] = useState(false)
  const keyRef = useRef<string>('')

  useEffect(() => {
    if (!stream || !enabled) {
      setSpeaking(false)
      return
    }
    const key = `local:${stream.id}`
    keyRef.current = key
    const detach = attachMeter(key, stream)
    return () => { detach(); setSpeaking(false) }
  }, [stream, enabled])

  useEffect(() => subscribeLevels((map) => {
    const level = map.get(keyRef.current) ?? 0
    setSpeaking(prev => {
      const next = level > SPEAKING_THRESHOLD
      return prev === next ? prev : next
    })
  }), [])

  return speaking
}

/** Niveau brut (0-255) d'un flux, pour les barres d'activité. */
export function useAudioLevel(key: string, stream: MediaStream | null | undefined): number {
  const [level, setLevel] = useState(0)

  useEffect(() => {
    if (!stream) { setLevel(0); return }
    const detach = attachMeter(key, stream)
    return () => { detach(); setLevel(0) }
  }, [key, stream])

  useEffect(() => subscribeLevels((map) => {
    const v = map.get(key) ?? 0
    setLevel(prev => (prev === v ? prev : v))
  }), [key])

  return level
}
