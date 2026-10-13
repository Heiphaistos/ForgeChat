// Consignes de publication d'un forum (post_guidelines) et réaction par défaut du salon.
import { useQuery } from '@tanstack/react-query'
import { Info } from 'lucide-react'
import api from '../../api/client'
import { useT } from '../../i18n'

/** Bandeau repliable (liste du forum) ou encadré ouvert (fenêtre de nouvelle publication). */
export default function ForumGuidelines({ text, open }: { text?: string | null; open?: boolean }) {
  const t = useT()
  if (!text?.trim()) return null
  return (
    <details open={open} className="group rounded-lg border border-fc-accent/30 bg-fc-accent/10 text-sm">
      <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none text-white font-medium">
        <Info size={14} className="text-fc-accent flex-shrink-0" aria-hidden />
        {t('dfeat.forum.guidelines')}
      </summary>
      {/* Texte brut : retours à la ligne conservés, aucun HTML interprété. */}
      <p className="px-3 pb-3 text-fc-text whitespace-pre-wrap break-words">{text}</p>
    </details>
  )
}

/** Réaction par défaut du salon, lue dans le cache `GET /servers/:id` (mis à jour par CHANNEL_UPDATE). */
export function useDefaultReaction(serverId: string, channelId: string): string | null {
  const { data } = useQuery({
    queryKey: ['server', serverId],
    queryFn: () => api.get(`/servers/${serverId}`).then(r => r.data),
    enabled: !!serverId,
    staleTime: 60_000,
  })
  const ch = (data?.channels as { id: string; default_reaction_emoji?: string | null }[] | undefined)?.find(c => c.id === channelId)
  return ch?.default_reaction_emoji?.trim() || null
}
