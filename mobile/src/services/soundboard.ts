import { createAudioPlayer } from 'expo-audio'
import { resolveMediaUrl } from '@/lib/links'
import { logger } from '@/lib/logger'

/** Filet de sécurité : un lecteur qui ne finit jamais (fichier illisible) est libéré quand même. */
const MAX_PLAY_MS = 120_000

/**
 * Joue un son du soundboard. Seules les adresses /uploads/ du serveur sont acceptées : le
 * `file_url` d'un SOUNDBOARD_PLAY vient d'un autre membre (même garde que le client web).
 */
export function playSoundFile(fileUrl: unknown): void {
  if (typeof fileUrl !== 'string' || !fileUrl.startsWith('/uploads/')) return
  const uri = resolveMediaUrl(fileUrl)
  if (!uri) return
  try {
    const player = createAudioPlayer(uri)
    let done = false
    const release = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      sub.remove()
      player.remove()
    }
    const timer = setTimeout(release, MAX_PLAY_MS)
    const sub = player.addListener('playbackStatusUpdate', (s) => {
      if (s.didJustFinish) release()
    })
    player.play()
  } catch (e) {
    logger.warn('soundboard', 'lecture', e)
  }
}
