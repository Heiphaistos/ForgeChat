// Messages système du lot communauté : bienvenue (carte générée) et starboard.
// Le starboard ne porte qu'une RÉFÉRENCE : le message mis en avant est rechargé
// depuis son salon d'origine et déchiffré ici, par un membre qui en a la clé.
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import api, { mediaUrl } from '../../api/client'
import { openMessage } from '../../e2e/conversations'
import { renderMarkdown } from '../../utils/markdown'
import { useT } from '../../i18n'
import GeneratedCard from './GeneratedCard'

export const isCommunitySystemMessage = (msg: { type?: string }) => msg.type === 'welcome' || msg.type === 'starboard'

function Starboard({ msg, serverId }: { msg: any; serverId: string }) {
  const t = useT()
  const nav = useNavigate()
  const meta = msg.system_meta ?? {}
  const src: string | undefined = meta.source_channel_id
  const mid: string | undefined = meta.source_message_id
  const { data, isError } = useQuery({
    queryKey: ['starboard_ref', mid],
    enabled: !!src && !!mid,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const r = await api.get(`/servers/${serverId}/channels/${src}/messages?around=${mid}&limit=1`)
      const m = (r.data as any[]).find(x => x.id === mid)
      return m ? openMessage('channel', src!, m) : null
    },
  })
  const stars = data?.reactions?.find((r: any) => r.emoji === meta.emoji)?.count
  return (
    <div className="mt-1 max-w-[520px] border-l-4 border-yellow-400 bg-fc-channel/60 rounded-r-lg p-3">
      <div className="flex items-center gap-2 text-xs text-fc-muted mb-1">
        <span className="text-yellow-400 font-semibold">{meta.emoji ?? '⭐'} {stars ?? ''}</span>
        <span className="truncate">{msg.content}</span>
      </div>
      {data ? (
        <div className="flex gap-2">
          {data.author_avatar && <img src={mediaUrl(data.author_avatar)} alt="" className="w-6 h-6 rounded-full flex-shrink-0" />}
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">{data.author_username}</div>
            <div className="text-sm text-fc-text break-words">{renderMarkdown(data.content ?? '', {})}</div>
          </div>
        </div>
      ) : (
        <div className="text-xs text-fc-muted italic">{isError || data === null ? t('community.starboard.unavailable') : t('common.loading')}</div>
      )}
      {src && mid && (
        <button onClick={() => nav(`/servers/${serverId}/channels/${src}?highlight=${mid}`)}
          className="mt-2 text-xs text-fc-accent hover:underline">
          {t('community.starboard.jump')}
        </button>
      )}
    </div>
  )
}

export default function SystemMessageCard({ msg, serverId }: { msg: any; serverId: string }) {
  const t = useT()
  if (msg.type === 'starboard') return <Starboard msg={msg} serverId={serverId} />
  const n = msg.system_meta?.member_number
  return (
    <GeneratedCard
      filename="bienvenue.png"
      data={{
        name: msg.author_username ?? '?',
        avatar: msg.author_avatar,
        title: t('community.welcome.cardTitle', { name: msg.author_username ?? '?' }),
        subtitle: msg.content ?? '',
        footer: n ? t('community.welcome.memberNumber', { n }) : undefined,
      }}
    />
  )
}
