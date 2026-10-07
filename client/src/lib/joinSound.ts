// Son d'arrivée en vocal (gratuit) : un son du soundboard, choisi dans n'importe quel
// serveur dont on est membre, joué pour tout le salon quand on rejoint un vocal.
// Passe par SOUNDBOARD_PLAY : le serveur vérifie l'appartenance et limite le débit.
import { useEffect, useState } from 'react'
import { mediaUrl } from '../api/client'
import { useWs } from '../store/ws'

export interface JoinSound { id: string; name: string; file_url: string }

const KEY = 'fc.joinSound'
const EVENT = 'fc-join-sound'

export function getJoinSound(): JoinSound | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    return v && typeof v.id === 'string' && typeof v.file_url === 'string' && v.file_url.startsWith('/uploads/') && !v.file_url.includes('..')
      ? { id: v.id, name: String(v.name ?? ''), file_url: v.file_url }
      : null
  } catch {
    return null
  }
}

export function setJoinSound(s: JoinSound | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s))
    else localStorage.removeItem(KEY)
  } catch { /* stockage bloqué : pas de son d'arrivée */ }
  window.dispatchEvent(new Event(EVENT))
}

export function useJoinSound(): JoinSound | null {
  const [s, setS] = useState(getJoinSound)
  useEffect(() => {
    const update = () => setS(getJoinSound())
    window.addEventListener(EVENT, update)
    return () => window.removeEventListener(EVENT, update)
  }, [])
  return s
}

/** À l'arrivée dans un salon vocal : joue le son pour soi et le diffuse au salon. */
export function playJoinSound(channelId: string) {
  const s = getJoinSound()
  if (!s) return
  useWs.getState().send({ type: 'SOUNDBOARD_PLAY', sound_id: s.id, channel_id: channelId })
  let volume = 80
  try { volume = Math.min(100, Math.max(0, parseInt(localStorage.getItem('forgechat_soundboard_volume') ?? '80', 10) || 0)) } catch { /* défaut */ }
  const audio = new Audio(mediaUrl(s.file_url))
  audio.volume = volume / 100
  audio.play().catch(() => null)
}
