// Réglages « Communauté » d'un serveur : annuaire, niveaux, starboard (puis
// bienvenue et tickets, WelcomeTicketsSettings).
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../api/client'
import { useT } from '../../i18n'
import { parseTags } from './format'
import { btnCls, ChannelSelect, Field, inputCls, Section } from './ui'
import { errText, useRoles, useSetting } from './hooks'
import WelcomeTicketsSettings from './WelcomeTicketsSettings'
import { grantable } from '../modals/OnboardingTab'

interface Props {
  server: { id: string; name: string; discovery_tags?: string[]; is_public?: boolean }
  channels: { id: string; name: string; type?: string }[]
}

interface Levels { enabled: boolean; xp_per_message: number; xp_per_voice_minute: number; roles: { level: number; role_id: string }[] }
interface Starboard { enabled: boolean; channel_id: string | null; emoji: string; threshold: number }

function Directory({ server }: Props) {
  const t = useT()
  const qc = useQueryClient()
  const [tags, setTags] = useState((server.discovery_tags ?? []).join(', '))
  const save = useMutation({
    mutationFn: () => api.patch(`/servers/${server.id}`, { discovery_tags: parseTags(tags) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['server', server.id] }); toast.success(t('community.saved')) },
    onError: (e: any) => toast.error(errText(e, t('common.error'))),
  })
  return (
    <Section title={t('community.directory.title')} desc={t(server.is_public ? 'community.directory.desc' : 'community.directory.private')}>
      <Field label={t('community.directory.tags')}>
        <input value={tags} onChange={e => setTags(e.target.value)} maxLength={140} placeholder={t('community.directory.tagsPh')} className={inputCls} />
      </Field>
      <button onClick={() => save.mutate()} disabled={save.isPending} className={btnCls}>{t('common.save')}</button>
    </Section>
  )
}

function LevelsSection({ server }: Props) {
  const t = useT()
  const { local, setLocal, save } = useSetting<Levels>(server.id, 'levels', { enabled: false, xp_per_message: 15, xp_per_voice_minute: 10, roles: [] })
  const { data: roles = [] } = useRoles(server.id)
  const [lvl, setLvl] = useState(5)
  const [roleId, setRoleId] = useState('')
  // Le serveur refuse tout rôle à droits sensibles : ne pas le proposer.
  const usable = roles.filter(grantable)
  const add = () => {
    if (!roleId || local.roles.some(r => r.level === lvl && r.role_id === roleId)) return
    setLocal({ ...local, roles: [...local.roles, { level: lvl, role_id: roleId }].sort((a, b) => a.level - b.level) })
  }
  return (
    <Section title={t('community.levels.title')} desc={t('community.levels.desc')} enabled={local.enabled}
      onToggle={v => setLocal({ ...local, enabled: v })}>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('community.levels.perMessage')}>
          <input type="number" min={0} max={1000} value={local.xp_per_message} className={inputCls}
            onChange={e => setLocal({ ...local, xp_per_message: Number(e.target.value) })} />
        </Field>
        <Field label={t('community.levels.perVoice')}>
          <input type="number" min={0} max={1000} value={local.xp_per_voice_minute} className={inputCls}
            onChange={e => setLocal({ ...local, xp_per_voice_minute: Number(e.target.value) })} />
        </Field>
      </div>
      <p className="text-xs text-fc-muted">{t('community.levels.antispam')}</p>
      <div>
        <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1">{t('community.levels.roles')}</div>
        <ul className="space-y-1 mb-2">
          {local.roles.map(r => (
            <li key={`${r.level}-${r.role_id}`} className="flex items-center gap-2 text-sm text-white">
              <span className="text-fc-muted w-20">{t('community.levels.level', { n: r.level })}</span>
              <span className="flex-1 truncate">{roles.find(x => x.id === r.role_id)?.name ?? r.role_id}</span>
              <button onClick={() => setLocal({ ...local, roles: local.roles.filter(x => x !== r) })} aria-label={t('common.delete')}
                className="p-1 text-fc-muted hover:text-fc-red"><X size={13} /></button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <input type="number" min={1} max={1000} value={lvl} onChange={e => setLvl(Number(e.target.value))}
            aria-label={t('community.levels.levelLabel')} className={`${inputCls} !w-20`} />
          <select value={roleId} onChange={e => setRoleId(e.target.value)} aria-label={t('community.levels.role')} className={inputCls}>
            <option value="">{t('community.levels.role')}</option>
            {usable.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <button onClick={add} aria-label={t('community.add')} className="px-3 bg-fc-hover rounded text-white"><Plus size={14} /></button>
        </div>
        <p className="text-xs text-fc-muted mt-1">{t('community.levels.safeRoles')}</p>
      </div>
      <button onClick={() => save.mutate(local)} disabled={save.isPending} className={btnCls}>{t('common.save')}</button>
    </Section>
  )
}

function StarboardSection({ server, channels }: Props) {
  const t = useT()
  const { local, setLocal, save } = useSetting<Starboard>(server.id, 'starboard', { enabled: false, channel_id: null, emoji: '⭐', threshold: 3 })
  return (
    <Section title={t('community.starboard.title')} desc={t('community.starboard.desc')} enabled={local.enabled}
      onToggle={v => setLocal({ ...local, enabled: v })}>
      <ChannelSelect label={t('community.starboard.channel')} value={local.channel_id} channels={channels}
        allowNone={t('community.none')} onChange={v => setLocal({ ...local, channel_id: v })} />
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('community.starboard.emoji')}>
          <input value={local.emoji} maxLength={64} onChange={e => setLocal({ ...local, emoji: e.target.value })} className={inputCls} />
        </Field>
        <Field label={t('community.starboard.threshold')}>
          <input type="number" min={1} max={100} value={local.threshold} className={inputCls}
            onChange={e => setLocal({ ...local, threshold: Number(e.target.value) })} />
        </Field>
      </div>
      <button onClick={() => save.mutate(local)} disabled={save.isPending} className={btnCls}>{t('common.save')}</button>
    </Section>
  )
}

export default function CommunitySettings(props: Props) {
  const t = useT()
  return (
    <div className="space-y-4">
      <p className="text-sm text-fc-muted">{t('community.intro')}</p>
      <Directory {...props} />
      <LevelsSection {...props} />
      <StarboardSection {...props} />
      <WelcomeTicketsSettings {...props} />
    </div>
  )
}
