// Mode streamer : réglage du compte (`streamer_mode`), raccourci clavier, et activation
// automatique quand un logiciel de diffusion tourne (app de bureau). L'état courant vit dans
// l'attribut `data-streamer-mode` de <html>, lu par index.css et par streamerActive().
import { useEffect, useState } from 'react'
import api from '../api/client'
import { queryClient } from '../main'
import { streamerActive, useUxPrefs } from './uxPrefs'
import { isStreamingSoftwareRunning } from './streamingDetect'

const setAttr = (on: boolean) => document.documentElement.setAttribute('data-streamer-mode', String(on))

/** Allume ou éteint le mode streamer ; `persist` l'enregistre aussi sur le compte. */
export function setStreamerMode(on: boolean, persist: boolean) {
  setAttr(on)
  if (!persist) return
  queryClient.setQueryData<Record<string, unknown>>(['user-settings'], d => (d ? { ...d, streamer_mode: on } : d))
  api.put('/user/settings', { streamer_mode: on }).catch(() => {})
}

/** Raccourci « Basculer le mode streamer ». */
export const toggleStreamerMode = () => setStreamerMode(!streamerActive(), true)

/** État courant, mis à jour au moindre changement (réglage, raccourci, détection). */
export function useStreamerActive(): boolean {
  const [on, setOn] = useState(streamerActive)
  useEffect(() => {
    const obs = new MutationObserver(() => setOn(streamerActive()))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-streamer-mode'] })
    return () => obs.disconnect()
  }, [])
  return on
}

/**
 * Activation automatique : toutes les 15 s, si un logiciel de diffusion démarre, le mode
 * s'allume (pour la session) ; à son arrêt, on revient au réglage du compte. Un mode allumé
 * à la main n'est jamais éteint par la détection.
 */
export function useStreamerAuto(loggedIn: boolean) {
  const auto = useUxPrefs(s => s.smAuto)
  useEffect(() => {
    if (!loggedIn || !auto) return
    let turnedOn = false
    let stopped = false
    const tick = async () => {
      const running = await isStreamingSoftwareRunning()
      if (stopped) return
      if (running && !streamerActive()) { setAttr(true); turnedOn = true }
      else if (!running && turnedOn) {
        turnedOn = false
        setAttr(queryClient.getQueryData<{ streamer_mode?: boolean }>(['user-settings'])?.streamer_mode === true)
      }
    }
    void tick()
    const t = setInterval(tick, 15_000)
    return () => { stopped = true; clearInterval(t) }
  }, [loggedIn, auto])
}
