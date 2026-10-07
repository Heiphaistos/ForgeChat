import { create } from 'zustand'
import { SPATIAL_KEY, spatialEnabled } from '../lib/spatialAudio'

/** Voix spatiale (casque) : réglage local, appliqué tout de suite à la lecture du salon. */
export const useSpatial = create<{ on: boolean; set(on: boolean): void }>(set => ({
  on: spatialEnabled(),
  set: on => {
    try { localStorage.setItem(SPATIAL_KEY, String(on)) } catch { /* stockage indisponible : réglage de session */ }
    set({ on })
  },
}))
