import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../api/client'
import { confirm } from '../ui/ConfirmModal'
import { forgetServerCommands } from '../../e2e/channels'
import { commandUsage, serverCommandsKey, useServerCommands, type ServerCommand } from '../../lib/serverCommands'
import { useT, type Key } from '../../i18n'

interface Role { id: string; name: string; color: number; is_everyone?: boolean }

/** Permissions proposées pour une commande de bot (les natives ne peuvent qu'être restreintes). */
const BOT_PERMS = ['MANAGE_MESSAGES', 'KICK_MEMBERS', 'BAN_MEMBERS', 'MANAGE_ROLES', 'MANAGE_CHANNELS', 'MANAGE_SERVER', 'ADMINISTRATOR'] as const

const CATEGORY_ORDER = ['moderation', 'utility', 'fun', 'general']

interface Patch { enabled: boolean; allowed_role_ids: string[]; required_permission: string | null }

function permLabel(t: (k: Key, v?: Record<string, string | number>) => string, perm: string): string {
  if (perm === 'everyone' || perm === 'owner') return t(`cmd.perm.${perm}` as Key)
  return perm.split('|').map(p => t(`cmd.perm.${p}` as Key)).join(' / ')
}

export default function CommandsTab({ serverId }: { serverId: string }) {
  const t = useT()
  const qc = useQueryClient()
  const { data: commands = [], isLoading } = useServerCommands(serverId)
  const { data: roles = [] } = useQuery<Role[]>({
    queryKey: ['roles', serverId],
    queryFn: () => api.get(`/servers/${serverId}/roles`).then(r => r.data),
    staleTime: 60_000,
  })
  const assignable = roles.filter(r => !r.is_everyone)

  const refresh = () => {
    forgetServerCommands(serverId)
    qc.invalidateQueries({ queryKey: serverCommandsKey(serverId) })
  }
  const save = useMutation({
    mutationFn: ({ name, patch }: { name: string; patch: Patch }) => api.put(`/servers/${serverId}/commands/${name}/override`, patch),
    onSuccess: () => { refresh(); toast.success(t('cmd.tab.saved')) },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('common.error')),
  })
  const reset = useMutation({
    mutationFn: (name: string) => api.delete(`/servers/${serverId}/commands/${name}/override`),
    onSuccess: () => { refresh(); toast.success(t('cmd.tab.reseted')) },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('common.error')),
  })

  const groups = useMemo(() => {
    const by = new Map<string, ServerCommand[]>()
    for (const c of commands) by.set(c.category, [...(by.get(c.category) ?? []), c])
    return [...by.entries()].sort(([a], [b]) => {
      const ia = CATEGORY_ORDER.indexOf(a), ib = CATEGORY_ORDER.indexOf(b)
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b)
    })
  }, [commands])

  if (isLoading) return <div role="status" className="text-fc-muted text-sm">{t('cmd.tab.loading')}</div>
  if (commands.length === 0) return <div className="text-center text-fc-muted py-12 text-sm">{t('cmd.tab.empty')}</div>

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-white mb-1">{t('cmd.tab.title')}</h3>
        <p className="text-sm text-fc-muted">{t('cmd.tab.intro')}</p>
      </div>
      {groups.map(([cat, list]) => (
        <section key={cat} aria-labelledby={`cmd-cat-${cat}`}>
          <h4 id={`cmd-cat-${cat}`} className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">
            {['moderation', 'utility', 'fun', 'general'].includes(cat) ? t(`cmd.cat.${cat}` as Key) : cat}
          </h4>
          <div className="space-y-2">
            {list.map(c => (
              <CommandRow key={c.name} cmd={c} roles={assignable} busy={save.isPending || reset.isPending}
                onSave={patch => save.mutate({ name: c.name, patch })} onReset={() => reset.mutate(c.name)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function CommandRow({ cmd, roles, busy, onSave, onReset }: {
  cmd: ServerCommand
  roles: Role[]
  busy: boolean
  onSave: (p: Patch) => void
  onReset: () => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const customized = !cmd.enabled || cmd.allowed_role_ids.length > 0 || cmd.required_permission !== cmd.default_permission
  const current: Patch = {
    enabled: cmd.enabled,
    allowed_role_ids: cmd.allowed_role_ids,
    required_permission: cmd.required_permission === cmd.default_permission ? null : cmd.required_permission,
  }
  const permOptions = cmd.native ? ['owner'] : ['everyone', 'owner', ...BOT_PERMS]

  const changePermission = async (value: string) => {
    const next = value === '' ? null : value
    // Ouvrir une commande de bot dangereuse à tous : confirmation explicite.
    if (cmd.dangerous && !cmd.native && next === 'everyone' && !(await confirm({
      message: t('cmd.tab.confirmOpen', { cmd: cmd.name }), confirmLabel: t('cmd.tab.confirmOpenYes'),
    }))) return
    onSave({ ...current, required_permission: next })
  }
  const toggleRole = (id: string) => {
    const set = new Set(cmd.allowed_role_ids)
    if (!set.delete(id)) set.add(id)
    onSave({ ...current, allowed_role_ids: [...set] })
  }

  return (
    <div className={`rounded-lg bg-fc-channel border ${cmd.dangerous ? 'border-red-500/40' : 'border-transparent'}`}>
      <div className="flex items-center gap-3 p-3">
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label={`/${cmd.name}`}
          className="text-fc-muted hover:text-white flex-shrink-0">
          {open ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <code className="text-sm text-white font-medium">{commandUsage(cmd)}</code>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-medium">
              {cmd.native ? t('cmd.tab.native') : cmd.bot_name}
            </span>
            {cmd.dangerous && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 font-medium flex items-center gap-1">
                <AlertTriangle size={10} aria-hidden />{t('cmd.dangerous')}
              </span>
            )}
            {customized && <span className="text-[10px] px-1.5 py-0.5 rounded bg-fc-accent/20 text-fc-accent font-medium">{t('cmd.tab.customized')}</span>}
          </div>
          <div className="text-xs text-fc-muted truncate">{cmd.description}</div>
        </div>
        <label className="flex items-center gap-2 text-xs text-fc-muted flex-shrink-0 cursor-pointer">
          <input type="checkbox" checked={cmd.enabled} disabled={busy}
            onChange={e => onSave({ ...current, enabled: e.target.checked })}
            aria-label={`${t('cmd.tab.enabled')} /${cmd.name}`} className="accent-fc-accent w-4 h-4" />
          <span className="hidden sm:inline">{t('cmd.tab.enabled')}</span>
        </label>
      </div>
      {open && (
        <div className="px-3 pb-3 pt-1 space-y-3 border-t border-fc-hover/50">
          {cmd.dangerous && (
            <p className="flex items-start gap-2 text-xs text-red-300 bg-red-500/10 rounded p-2">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" aria-hidden />{t('cmd.tab.dangerWarn')}
            </p>
          )}
          <label className="block text-xs text-fc-muted">
            {t('cmd.tab.permission')}
            <select value={current.required_permission ?? ''} disabled={busy}
              onChange={e => { void changePermission(e.target.value) }}
              className="mt-1 block w-full sm:w-72 px-2 py-1.5 bg-fc-input rounded text-white text-sm outline-none focus:ring-2 focus:ring-fc-accent">
              <option value="">{t('cmd.perm.default', { perm: permLabel(t, cmd.default_permission) })}</option>
              {permOptions.map(p => <option key={p} value={p}>{permLabel(t, p)}</option>)}
            </select>
          </label>
          <fieldset>
            <legend className="text-xs text-fc-muted">{t('cmd.tab.roles')}</legend>
            <p className="text-[11px] text-fc-muted/70 mb-1">{t('cmd.tab.rolesHint')}</p>
            <div className="flex flex-wrap gap-2">
              {roles.map(r => (
                <label key={r.id} className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs cursor-pointer
                  ${cmd.allowed_role_ids.includes(r.id) ? 'bg-fc-accent/20 text-white' : 'bg-fc-input text-fc-muted hover:text-white'}`}>
                  <input type="checkbox" checked={cmd.allowed_role_ids.includes(r.id)} disabled={busy}
                    onChange={() => toggleRole(r.id)} className="accent-fc-accent" />
                  <span style={r.color ? { color: `#${r.color.toString(16).padStart(6, '0')}` } : undefined}>{r.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {customized && (
            <button type="button" onClick={onReset} disabled={busy}
              className="flex items-center gap-1.5 text-xs text-fc-muted hover:text-white disabled:opacity-50">
              <RotateCcw size={12} aria-hidden />{t('cmd.tab.reset')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
