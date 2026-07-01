import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Shield, Tag, UserMinus } from 'lucide-react'
import api from '../../api/client'
import toast from 'react-hot-toast'

interface Role { id: string; name: string; color: number }
interface MemberTag { id: string; name: string; color: number }
interface Member {
  user_id: string
  username: string
  discriminator: string
  avatar: string | null
  status: string
  nickname: string | null
  is_owner: boolean
  roles: Role[]
  tags: MemberTag[]
}

function colorIntToHex(c: number): string {
  return '#' + (c >>> 0).toString(16).padStart(6, '0')
}

export default function MembersTab({ serverId }: { serverId: string }) {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: members = [] } = useQuery<Member[]>({
    queryKey: ['members_detailed', serverId],
    queryFn: () => api.get(`/servers/${serverId}/members/detailed`).then(r => r.data),
  })

  const { data: roles = [] } = useQuery<Role[]>({
    queryKey: ['roles', serverId],
    queryFn: () => api.get(`/servers/${serverId}/roles`).then(r => r.data),
  })

  const { data: tags = [] } = useQuery<MemberTag[]>({
    queryKey: ['tags', serverId],
    queryFn: () => api.get(`/servers/${serverId}/tags`).then(r => r.data),
  })

  const kick = useMutation({
    mutationFn: (userId: string) => api.post(`/servers/${serverId}/members/${userId}/kick`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['members_detailed', serverId] })
      toast.success('Membre expulsé')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const assignRole = useMutation({
    mutationFn: ({ userId, roleId }: { userId: string; roleId: string }) =>
      api.put(`/servers/${serverId}/members/${userId}/roles/${roleId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members_detailed', serverId] }),
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const removeRole = useMutation({
    mutationFn: ({ userId, roleId }: { userId: string; roleId: string }) =>
      api.delete(`/servers/${serverId}/members/${userId}/roles/${roleId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members_detailed', serverId] }),
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const assignTag = useMutation({
    mutationFn: ({ userId, tagId }: { userId: string; tagId: string }) =>
      api.put(`/servers/${serverId}/members/${userId}/tags/${tagId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members_detailed', serverId] }),
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const removeTagMutation = useMutation({
    mutationFn: ({ userId, tagId }: { userId: string; tagId: string }) =>
      api.delete(`/servers/${serverId}/members/${userId}/tags/${tagId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members_detailed', serverId] }),
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const filtered = members.filter(m =>
    m.username.toLowerCase().includes(search.toLowerCase())
  )

  const nonEveryoneRoles = roles.filter((r: any) => !r.is_everyone)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Rechercher un membre..."
          className="flex-1 px-3 py-2 bg-fc-input rounded text-white text-sm outline-none focus:ring-2 focus:ring-fc-accent"
        />
        <span className="text-fc-muted text-sm">{filtered.length} membre(s)</span>
      </div>

      <div className="space-y-1">
        {filtered.map(m => (
          <div key={m.user_id} className="bg-fc-channel rounded-lg overflow-hidden">
            {/* Ligne principale */}
            <div
              className="flex items-center gap-3 p-3 cursor-pointer hover:bg-fc-hover transition"
              onClick={() => setExpandedId(expandedId === m.user_id ? null : m.user_id)}
            >
              <div className="relative flex-shrink-0">
                <div className="w-9 h-9 rounded-full bg-fc-accent flex items-center justify-center text-white font-bold text-sm overflow-hidden">
                  {m.avatar
                    ? <img src={m.avatar} alt="" className="w-full h-full object-cover" />
                    : m.username.charAt(0).toUpperCase()}
                </div>
                <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-fc-channel
                  ${m.status === 'online' ? 'bg-green-500' : m.status === 'idle' ? 'bg-yellow-400' : m.status === 'dnd' ? 'bg-red-500' : 'bg-gray-500'}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-white text-sm font-medium">{m.username}</span>
                  {m.is_owner && (
                    <span className="text-xs bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded">Owner</span>
                  )}
                  {m.roles.map(r => (
                    <span key={r.id} className="text-xs px-1.5 py-0.5 rounded font-medium"
                      style={{ backgroundColor: `${colorIntToHex(r.color)}30`, color: colorIntToHex(r.color) || '#99aab5' }}
                    >
                      {r.name}
                    </span>
                  ))}
                  {m.tags.map(t => (
                    <span key={t.id} className="text-xs px-1.5 py-0.5 rounded font-medium border"
                      style={{ borderColor: colorIntToHex(t.color), color: colorIntToHex(t.color) }}
                    >
                      [{t.name}]
                    </span>
                  ))}
                </div>
              </div>
              {!m.is_owner && (
                <button
                  onClick={e => { e.stopPropagation(); kick.mutate(m.user_id) }}
                  className="p-1.5 text-fc-muted hover:text-red-400 hover:bg-fc-hover rounded transition flex-shrink-0"
                  title="Expulser"
                >
                  <UserMinus size={14} />
                </button>
              )}
            </div>

            {/* Panneau étendu */}
            {expandedId === m.user_id && (
              <div className="border-t border-fc-hover p-3 space-y-3">
                {/* Rôles */}
                {nonEveryoneRoles.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1 text-xs text-fc-muted uppercase font-semibold mb-1.5">
                      <Shield size={11} /> Rôles
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {nonEveryoneRoles.map((r: any) => {
                        const has = m.roles.some(mr => mr.id === r.id)
                        return (
                          <button key={r.id}
                            onClick={() => has
                              ? removeRole.mutate({ userId: m.user_id, roleId: r.id })
                              : assignRole.mutate({ userId: m.user_id, roleId: r.id })}
                            className={`text-xs px-2 py-1 rounded transition font-medium border
                              ${has ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300' : 'border-fc-hover text-fc-muted hover:border-indigo-500/50 hover:text-white'}`}
                          >
                            {r.name}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Tags */}
                {tags.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1 text-xs text-fc-muted uppercase font-semibold mb-1.5">
                      <Tag size={11} /> Tags clan
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {tags.map((t: any) => {
                        const has = m.tags.some(mt => mt.id === t.id)
                        return (
                          <button key={t.id}
                            onClick={() => has
                              ? removeTagMutation.mutate({ userId: m.user_id, tagId: t.id })
                              : assignTag.mutate({ userId: m.user_id, tagId: t.id })}
                            style={{ borderColor: colorIntToHex(t.color), color: has ? colorIntToHex(t.color) : undefined }}
                            className={`text-xs px-2 py-1 rounded transition font-medium border
                              ${has ? 'bg-white/5' : 'border-fc-hover text-fc-muted hover:text-white'}`}
                          >
                            [{t.name}]
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
