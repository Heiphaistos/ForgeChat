// Statut riche (lot « Profil et social ») : jeu, musique, vidéo… et « en appel ».
// Le serveur a déjà retiré ce que la personne ne montre pas au lecteur.
import type { Key } from '@/i18n'

export interface RichActivity {
  activity_type?: string | null
  activity_name?: string | null
  activity_detail?: string | null
  in_call?: boolean | null
}

const KINDS: Record<string, { icon: string; key: Key }> = {
  playing: { icon: '🎮', key: 'soc.playing' },
  listening: { icon: '🎵', key: 'soc.listening' },
  watching: { icon: '📺', key: 'soc.watching' },
  streaming: { icon: '📡', key: 'soc.streaming' },
  competing: { icon: '🏆', key: 'soc.competing' },
}

type Tr = (key: Key, vars?: Record<string, string | number>) => string

/** Texte affiché (« 🎵 Écoute X · 📞 En appel »), null si rien n'est visible. */
export function richText(a: RichActivity | null | undefined, t: Tr): string | null {
  if (!a) return null
  const parts: string[] = []
  const kind = a.activity_type ? KINDS[a.activity_type] : undefined
  if (kind && a.activity_name) parts.push(`${kind.icon} ${t(kind.key, { name: a.activity_name })}`)
  if (a.in_call) parts.push(`📞 ${t('soc.inCall')}`)
  return parts.length ? parts.join(' · ') : null
}

/** Lit les champs d'un événement PRESENCE_* (absents = pas d'information). */
export function activityFrom(e: Record<string, unknown>): RichActivity | undefined {
  if (!('activity_type' in e) && !('in_call' in e)) return undefined
  const s = (v: unknown) => (typeof v === 'string' ? v : null)
  return {
    activity_type: s(e.activity_type),
    activity_name: s(e.activity_name),
    activity_detail: s(e.activity_detail),
    in_call: e.in_call === true,
  }
}
