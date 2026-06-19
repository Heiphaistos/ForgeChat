import { useQuery } from '@tanstack/react-query'
import api from '../../api/client'
import { usePresence } from '../../store/presence'

interface Props {
  serverId: string
}

const STATUS_COLORS: Record<string, string> = {
  online: 'bg-fc-green',
  idle: 'bg-fc-yellow',
  dnd: 'bg-fc-red',
  offline: 'bg-fc-muted',
  invisible: 'bg-fc-muted',
}

export default function MemberList({ serverId }: Props) {
  const { data: members = [] } = useQuery({
    queryKey: ['members', serverId],
    queryFn: () => api.get(`/servers/${serverId}/members`).then(r => r.data),
    refetchInterval: 30_000,
  })

  const getStatus = usePresence(s => s.getStatus)

  // Statut live via presence store (WS), fallback sur le statut DB
  const membersWithLiveStatus = members.map((m: any) => ({
    ...m,
    liveStatus: getStatus(m.user_id) ?? m.status ?? 'offline',
  }))

  const online = membersWithLiveStatus.filter((m: any) =>
    m.liveStatus === 'online' || m.liveStatus === 'idle' || m.liveStatus === 'dnd'
  )
  const offline = membersWithLiveStatus.filter((m: any) =>
    m.liveStatus === 'offline' || m.liveStatus === 'invisible'
  )

  const MemberRow = ({ m }: { m: any }) => (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-fc-hover group cursor-pointer transition">
      <div className="relative flex-shrink-0">
        <div className="w-8 h-8 rounded-full bg-fc-accent flex items-center justify-center font-semibold text-sm text-white overflow-hidden">
          {m.avatar
            ? <img src={m.avatar} alt="" className="w-full h-full rounded-full object-cover" />
            : (m.nickname ?? m.username).charAt(0).toUpperCase()}
        </div>
        <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-fc-channel ${STATUS_COLORS[m.liveStatus] ?? 'bg-fc-muted'}`} />
      </div>
      <div className="min-w-0">
        <div className={`text-sm font-medium truncate ${m.liveStatus === 'offline' || m.liveStatus === 'invisible' ? 'text-fc-muted' : 'text-fc-text group-hover:text-white'}`}>
          {m.nickname ?? m.username}
          {m.is_owner && <span className="ml-1 text-xs text-fc-yellow">👑</span>}
        </div>
        {m.custom_status && (
          <div className="text-xs text-fc-muted truncate">{m.custom_status}</div>
        )}
      </div>
    </div>
  )

  return (
    <div className="w-60 bg-fc-channel flex-shrink-0 overflow-y-auto p-2 hidden lg:block">
      {online.length > 0 && (
        <>
          <div className="px-2 py-1 text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1">
            En ligne — {online.length}
          </div>
          {online.map((m: any) => <MemberRow key={m.user_id} m={m} />)}
        </>
      )}
      {offline.length > 0 && (
        <>
          <div className="px-2 py-1 text-xs font-semibold text-fc-muted uppercase tracking-wide mt-3 mb-1">
            Hors ligne — {offline.length}
          </div>
          {offline.map((m: any) => <MemberRow key={m.user_id} m={m} />)}
        </>
      )}
    </div>
  )
}
