import type { Attachment } from '@/types/models'

export type MediaKind = 'image' | 'video' | 'audio' | 'file'

/** Formats lus par les lecteurs intégrés (ExoPlayer / AVPlayer). Tout le reste : carte « fichier ». */
const VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm'])
const AUDIO_TYPES = new Set(['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/webm'])

export function mediaKind(a: Pick<Attachment, 'content_type'>): MediaKind {
  const t = a.content_type.toLowerCase().split(';')[0]!.trim()
  if (t.startsWith('image/')) return 'image'
  if (VIDEO_TYPES.has(t)) return 'video'
  if (AUDIO_TYPES.has(t)) return 'audio'
  return 'file'
}

/** « 1:05 », « 12:00 », « 1:02:03 » ; valeurs invalides → « 0:00 ». */
export function formatDuration(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}
