// Éditeur de surcharges de permissions (rôle ou membre → autoriser / refuser / hériter).
// Partagé par les salons (ChannelSettingsModal) et les catégories (CategoryTools) :
// seule la route change (`basePath` = …/permissions, GET / PUT :target / DELETE :target).
import { useState, useEffect } from 'react'
import { Shield, Plus, Trash2 } from 'lucide-react'
import { useMutation, useQuery } from '@tanstack/react-query'
import api from '../../api/client'
import toast from 'react-hot-toast'
import { useT } from '../../i18n'

// Permissions affichables dans les surcharges — mêmes bits que le serveur
// (server/src/models/role.rs::Permissions), seuls appliqués. Libellés : clés chperm.<key>.
const CHANNEL_PERMISSION_BITS = [
  { key: 'VIEW_CHANNEL',     bit: Math.pow(2, 0) },
  { key: 'SEND_MESSAGES',    bit: Math.pow(2, 1) },
  { key: 'READ_HISTORY',     bit: Math.pow(2, 2) },
  { key: 'MANAGE_MESSAGES',  bit: Math.pow(2, 3) },
  { key: 'ATTACH_FILES',     bit: Math.pow(2, 10) },
  { key: 'ADD_REACTIONS',    bit: Math.pow(2, 12) },
  { key: 'EMBED_LINKS',      bit: Math.pow(2, 11) },
  { key: 'MENTION_EVERYONE', bit: Math.pow(2, 9) },
  { key: 'CONNECT_VOICE',    bit: Math.pow(2, 13) },
  { key: 'SPEAK_VOICE',      bit: Math.pow(2, 14) },
  { key: 'STREAM',           bit: Math.pow(2, 40) },
  { key: 'MUTE_MEMBERS',     bit: Math.pow(2, 15) },
  { key: 'DEAFEN_MEMBERS',   bit: Math.pow(2, 16) },
  { key: 'MOVE_MEMBERS',     bit: Math.pow(2, 17) },
] as const

// Opérations en BigInt : `&`/`|` sur des nombres tronquent à 32 bits (STREAM = 2^40 était perdu).
const hasBit = (v: number, bit: number) => (BigInt(v) & BigInt(bit)) !== BigInt(0)
const withBit = (v: number, bit: number, on: boolean) => Number(on ? BigInt(v) | BigInt(bit) : BigInt(v) & ~BigInt(bit))

export type OverrideTarget = { id: string; name: string; type: 'role' | 'member' }
interface Override { target_id: string; target_type: 'role' | 'member'; allow: number; deny: number }
interface Role { id: string; name: string; color?: number | null }

interface Props {
  /** Ex. `/channels/:id/permissions` ou `/servers/:sid/categories/:cid/permissions`. */
  basePath: string
  queryKey: readonly unknown[]
  serverId: string
  initialTarget?: OverrideTarget
}

export default function PermissionOverridesEditor({ basePath, queryKey, serverId, initialTarget }: Props) {
  const t = useT()
  const [selectedTarget, setSelectedTarget] = useState<OverrideTarget | null>(initialTarget ?? null)
  const [editAllow, setEditAllow] = useState(0)
  const [editDeny, setEditDeny] = useState(0)

  const { data: roles = [] } = useQuery<Role[]>({
    queryKey: ['roles', serverId],
    queryFn: () => api.get(`/servers/${serverId}/roles`).then(r => r.data),
    staleTime: 60_000,
  })

  const { data: overrides = [], refetch, isFetched } = useQuery<Override[]>({
    queryKey,
    queryFn: () => api.get(basePath).then(r => r.data).catch((e: unknown) => { console.warn('[perm-overrides] lecture', basePath, e); return [] }),
    staleTime: 30_000,
  })
  // Membre choisi depuis son menu : sa surcharge existante, une fois la liste chargée.
  const [initialLoaded, setInitialLoaded] = useState(!initialTarget)
  useEffect(() => {
    if (initialLoaded || !isFetched || !initialTarget) return
    const existing = overrides.find(o => o.target_id === initialTarget.id)
    setEditAllow(existing?.allow ?? 0)
    setEditDeny(existing?.deny ?? 0)
    setInitialLoaded(true)
  }, [initialLoaded, isFetched, initialTarget, overrides])

  const errText = (e: unknown) => (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? t('common.error')

  const saveOverride = useMutation({
    mutationFn: () => api.put(`${basePath}/${selectedTarget!.id}`, { target_type: selectedTarget!.type, allow: editAllow, deny: editDeny }),
    onSuccess: () => { refetch(); toast.success(t('chset.permsSaved')) },
    onError: e => toast.error(errText(e)),
  })

  const deleteOverride = useMutation({
    mutationFn: (targetId: string) => api.delete(`${basePath}/${targetId}`),
    onSuccess: () => { refetch(); setSelectedTarget(null); toast.success(t('chset.overrideDeleted')) },
    onError: e => toast.error(errText(e)),
  })

  const selectTarget = (target: OverrideTarget) => {
    setSelectedTarget(target)
    const existing = overrides.find(o => o.target_id === target.id)
    setEditAllow(existing?.allow ?? 0)
    setEditDeny(existing?.deny ?? 0)
  }

  const addRole = (role: Role) => {
    if (!overrides.find(o => o.target_id === role.id)) {
      api.put(`${basePath}/${role.id}`, { target_type: 'role', allow: 0, deny: 0 })
        .then(() => refetch())
        .catch(e => toast.error(errText(e)))
    }
    selectTarget({ id: role.id, name: role.name, type: 'role' })
  }

  const getState = (bit: number): 'allow' | 'deny' | 'neutral' =>
    hasBit(editAllow, bit) ? 'allow' : hasBit(editDeny, bit) ? 'deny' : 'neutral'

  const setState = (bit: number, state: 'allow' | 'deny' | 'neutral') => {
    setEditAllow(a => withBit(a, bit, state === 'allow'))
    setEditDeny(d => withBit(d, bit, state === 'deny'))
  }

  return (
    <div className="flex gap-4 h-full min-h-0">
      {/* Cibles */}
      <div className="w-48 flex-shrink-0 overflow-y-auto overscroll-contain">
        <p className="text-xs text-fc-muted uppercase tracking-wide font-semibold mb-2">{t('chset.targets')}</p>
        <div className="space-y-0.5 mb-3">
          {overrides.map(o => {
            const role = roles.find(r => r.id === o.target_id)
            const name = role?.name ?? (initialTarget && o.target_id === initialTarget.id ? initialTarget.name : o.target_id.slice(0, 8))
            return (
              <button key={o.target_id}
                onClick={() => selectTarget({ id: o.target_id, name, type: o.target_type })}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg text-sm transition flex items-center gap-2
                  ${selectedTarget?.id === o.target_id ? 'bg-fc-accent/20 text-white' : 'text-fc-muted hover:text-white hover:bg-fc-hover/50'}`}>
                {o.target_type === 'role'
                  ? <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: role?.color ? '#' + role.color.toString(16).padStart(6, '0') : '#99aab5' }} />
                  : <Shield size={12} />
                }
                <span className="truncate">{name}</span>
              </button>
            )
          })}
        </div>

        {/* Ajouter un rôle */}
        <p className="text-xs text-fc-muted uppercase tracking-wide font-semibold mb-1">{t('chset.add')}</p>
        <div className="space-y-0.5">
          {roles.filter(r => !overrides.find(o => o.target_id === r.id)).map(r => (
            <button key={r.id}
              onClick={() => addRole(r)}
              className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-fc-muted/60 hover:text-white hover:bg-fc-hover/30 transition flex items-center gap-1.5">
              <Plus size={10} />
              <span className="truncate">{r.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Éditeur */}
      {selectedTarget ? (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-3 flex-shrink-0">
            <h4 className="font-semibold text-white text-sm">{selectedTarget.name}</h4>
            <div className="flex items-center gap-2">
              <button onClick={() => saveOverride.mutate()}
                disabled={saveOverride.isPending}
                className="px-3 py-1 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-xs font-medium transition disabled:opacity-50">
                {t('common.save')}
              </button>
              <button onClick={() => deleteOverride.mutate(selectedTarget.id)}
                className="p-1 text-fc-muted hover:text-red-400 rounded transition" title={t('chset.deleteOverride')} aria-label={t('chset.deleteOverride')}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>

          {/* Légende */}
          <div className="flex gap-3 text-xs text-fc-muted mb-3 flex-shrink-0">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-500" /> {t('chset.allowed')}</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-500" /> {t('chset.denied')}</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-fc-muted/30" /> {t('chset.inherited')}</span>
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain space-y-1 pr-1">
            {CHANNEL_PERMISSION_BITS.map(p => {
              const state = getState(p.bit)
              return (
                <div key={p.key}
                  className="flex items-center justify-between px-3 py-2 rounded-xl hover:bg-fc-hover/20 transition">
                  <span className="text-sm text-white">{t(`chperm.${p.key}`)}</span>
                  <div className="flex items-center gap-1">
                    {/* Neutre */}
                    <button onClick={() => setState(p.bit, 'neutral')} aria-label={`${t(`chperm.${p.key}`)} : ${t('chset.inherited')}`} aria-pressed={state === 'neutral'}
                      className={`w-6 h-6 rounded-full transition border-2 ${state === 'neutral' ? 'bg-fc-muted/30 border-fc-muted' : 'border-transparent hover:border-fc-muted/50'}`} />
                    {/* Autorisé */}
                    <button onClick={() => setState(p.bit, 'allow')} aria-label={`${t(`chperm.${p.key}`)} : ${t('chset.allowed')}`} aria-pressed={state === 'allow'}
                      className={`w-6 h-6 rounded-full transition flex items-center justify-center ${state === 'allow' ? 'bg-green-500' : 'hover:bg-green-500/20 border border-fc-hover'}`}>
                      {state === 'allow' && <span className="text-white text-xs">✓</span>}
                    </button>
                    {/* Refusé */}
                    <button onClick={() => setState(p.bit, 'deny')} aria-label={`${t(`chperm.${p.key}`)} : ${t('chset.denied')}`} aria-pressed={state === 'deny'}
                      className={`w-6 h-6 rounded-full transition flex items-center justify-center ${state === 'deny' ? 'bg-red-500' : 'hover:bg-red-500/20 border border-fc-hover'}`}>
                      {state === 'deny' && <span className="text-white text-xs">✕</span>}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-fc-muted text-sm">
          {t('chset.pickRole')}
        </div>
      )}
    </div>
  )
}
