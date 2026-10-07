import { requireOptionalNativeModule } from 'expo'
import { setStatusBarHidden } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { Platform } from 'react-native'

/**
 * Fenêtre des appels vidéo (modules/call-service, CallWindow.kt) : plein écran immersif (barres
 * système masquées, rotation suivie) et image dans l'image Android quand on quitte l'app.
 * iOS : barre d'état masquée seulement (app en portrait), image dans l'image par RTCView (iosPIP).
 */
interface CallWindowNative {
  setImmersive(on: boolean): void
  pipSupported(): boolean
  setPip(enabled: boolean, width: number, height: number): void
  enterPip(width: number, height: number): void
  addListener(event: 'onPipChange', fn: (e: { active: boolean }) => void): { remove(): void }
}

const mod = Platform.OS === 'android' ? requireOptionalNativeModule<CallWindowNative>('ForgeCallService') : null
/** null : iOS, ou build sans le module natif à jour. */
const native = mod && typeof mod.setImmersive === 'function' ? mod : null

function safe(fn: () => void) {
  try {
    fn()
  } catch {
    // Fenêtre indisponible (activité recréée) : l'appel continue, seul l'affichage change.
  }
}

/** Plein écran immersif tant que le composant est monté avec `on`. */
export function useImmersive(on: boolean) {
  useEffect(() => {
    if (!on) return
    if (native) safe(() => native.setImmersive(true))
    else setStatusBarHidden(true, 'fade')
    return () => {
      if (native) safe(() => native.setImmersive(false))
      else setStatusBarHidden(false, 'fade')
    }
  }, [on])
}

let supported: boolean | null = null
/** Image dans l'image disponible (Android 8+, fonction présente sur l'appareil). */
export function pipSupported(): boolean {
  if (supported === null) {
    supported = false
    if (native) safe(() => (supported = native.pipSupported()))
  }
  return supported
}

/** Ratio par défaut avant de connaître la vraie taille : écran partagé 16:9, caméra de téléphone 9:16. */
export const defaultRatio = (screen: boolean): [number, number] => (screen ? [16, 9] : [9, 16])

/** Entre en image dans l'image tout de suite (bouton ; Android 8 à 11 n'ont pas l'entrée automatique). */
export function enterPip([w, h]: [number, number]) {
  if (native && pipSupported()) safe(() => native.enterPip(w, h))
}

/** Met à jour le ratio de la fenêtre PiP (taille réelle de la vidéo affichée). */
export function updatePipRatio(w: number, h: number) {
  if (native && pipSupported() && w > 0 && h > 0) safe(() => native.setPip(true, Math.round(w), Math.round(h)))
}

/**
 * Image dans l'image d'un écran d'appel : entrée automatique en quittant l'app (Android 12+) tant que
 * `ratio` est fourni (une vidéo à montrer) ; null = appel audio seul, désactivé. Renvoie true pendant
 * le mode PiP : l'écran n'affiche alors que la vidéo principale.
 */
export function useCallPip(ratio: [number, number] | null): boolean {
  const [active, setActive] = useState(false)
  useEffect(() => {
    if (!native) return
    const sub = native.addListener('onPipChange', (e) => setActive(!!e.active))
    return () => sub.remove()
  }, [])
  const [w, h] = ratio ?? [0, 0]
  const on = !!ratio
  useEffect(() => {
    if (!native || !pipSupported()) return
    safe(() => native.setPip(on, w, h))
    return () => safe(() => native.setPip(false, 0, 0))
  }, [on, w, h])
  return active
}
