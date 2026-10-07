// Statut riche (lot « Profil et social ») : jeu, musique, vidéo… et « en appel ».
// Le serveur a déjà retiré ce que la personne ne montre pas au lecteur.
import { useT, type Key } from '../../i18n'

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

/** Lignes à afficher (activité puis appel), vide si rien n'est visible. */
export function useRichLines(a: RichActivity | null | undefined): { icon: string; text: string }[] {
  const t = useT()
  if (!a) return []
  const lines: { icon: string; text: string }[] = []
  const kind = a.activity_type ? KINDS[a.activity_type] : undefined
  if (kind && a.activity_name) lines.push({ icon: kind.icon, text: t(kind.key, { name: a.activity_name }) })
  if (a.in_call) lines.push({ icon: '📞', text: t('soc.inCall') })
  return lines
}

/** Statut riche sur une ligne (listes de membres, d'amis, en-tête de MP). */
export default function RichStatus({ activity, className = '' }: { activity: RichActivity | null | undefined; className?: string }) {
  const lines = useRichLines(activity)
  if (lines.length === 0) return null
  const label = lines.map(l => l.text).join(' · ')
  return (
    <span className={`flex items-center gap-1 truncate ${className}`} title={label}>
      {lines.map(l => (
        <span key={l.icon} className="flex items-center gap-1 truncate">
          <span aria-hidden>{l.icon}</span>
          <span className="truncate">{l.text}</span>
        </span>
      ))}
    </span>
  )
}
