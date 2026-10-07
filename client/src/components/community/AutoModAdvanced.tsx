// AutoMod avancé : débit d'envoi, anti-raid, liens dangereux (liste locale), verrouillage.
// Le contenu est chiffré : liens et mots sont vérifiés par l'appli de l'expéditeur,
// le serveur n'agit que sur les métadonnées (débit, arrivées).
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Lock, Unlock } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../api/client'
import { useT } from '../../i18n'
import { errText, useSetting } from './hooks'
import { btnCls, Field, inputCls, Section, Toggle } from './ui'

interface Advanced {
  rate_limit_count: number
  rate_limit_seconds: number
  raid_join_count: number
  raid_join_seconds: number
  block_dangerous_links: boolean
  blocked_domains: string[]
  lockdown?: boolean
  lockdown_reason?: string | null
  builtin_domains?: number
}

export function LockdownButton({ serverId, locked }: { serverId: string; locked: boolean }) {
  const t = useT()
  const qc = useQueryClient()
  const m = useMutation({
    mutationFn: () => api.put(`/servers/${serverId}/lockdown`, { enabled: !locked }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['server', serverId] })
      qc.invalidateQueries({ queryKey: ['community', serverId] })
      toast.success(t(locked ? 'community.lockdown.lifted' : 'community.lockdown.enabled'))
    },
    onError: (e: any) => toast.error(errText(e, t('common.error'))),
  })
  return (
    <button onClick={() => m.mutate()} disabled={m.isPending}
      className={`flex items-center gap-2 px-4 py-2 rounded text-sm font-semibold transition disabled:opacity-50 ${locked ? 'bg-fc-green/20 text-fc-green hover:bg-fc-green/30' : 'bg-fc-red/20 text-fc-red hover:bg-fc-red/30'}`}>
      {locked ? <Unlock size={14} aria-hidden /> : <Lock size={14} aria-hidden />}
      {t(locked ? 'community.lockdown.lift' : 'community.lockdown.enable')}
    </button>
  )
}

export default function AutoModAdvanced({ serverId }: { serverId: string }) {
  const t = useT()
  const { local, setLocal, save } = useSetting<Advanced>(serverId, 'automod/advanced', {
    rate_limit_count: 0, rate_limit_seconds: 10, raid_join_count: 0, raid_join_seconds: 60, block_dangerous_links: false, blocked_domains: [],
  })
  const [domains, setDomains] = useState<string | null>(null)
  const num = (k: keyof Advanced) => (e: React.ChangeEvent<HTMLInputElement>) => setLocal({ ...local, [k]: Number(e.target.value) })
  const submit = () => save.mutate({
    ...local,
    blocked_domains: (domains ?? local.blocked_domains.join('\n')).split(/[\s,]+/).map(d => d.trim()).filter(Boolean),
  })
  return (
    <div className="space-y-4 mt-6">
      <Section title={t('community.lockdown.title')} desc={t(local.lockdown ? (local.lockdown_reason === 'raid' ? 'community.lockdown.byRaid' : 'community.lockdown.on') : 'community.lockdown.desc')}>
        <LockdownButton serverId={serverId} locked={!!local.lockdown} />
      </Section>
      <Section title={t('community.automod.rate')} desc={t('community.automod.rateDesc')}>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('community.automod.messages')}><input type="number" min={0} max={100} value={local.rate_limit_count} onChange={num('rate_limit_count')} className={inputCls} /></Field>
          <Field label={t('community.automod.seconds')}><input type="number" min={1} max={300} value={local.rate_limit_seconds} onChange={num('rate_limit_seconds')} className={inputCls} /></Field>
        </div>
      </Section>
      <Section title={t('community.automod.raid')} desc={t('community.automod.raidDesc')}>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('community.automod.joins')}><input type="number" min={0} max={500} value={local.raid_join_count} onChange={num('raid_join_count')} className={inputCls} /></Field>
          <Field label={t('community.automod.seconds')}><input type="number" min={5} max={3600} value={local.raid_join_seconds} onChange={num('raid_join_seconds')} className={inputCls} /></Field>
        </div>
      </Section>
      <Section title={t('community.automod.links')} desc={t('community.automod.linksDesc', { n: local.builtin_domains ?? 0 })}>
        <div className="flex items-center justify-between text-sm text-white">
          {t('community.automod.blockLinks')}
          <Toggle checked={local.block_dangerous_links} onChange={v => setLocal({ ...local, block_dangerous_links: v })} label={t('community.automod.blockLinks')} />
        </div>
        <Field label={t('community.automod.domains')}>
          <textarea rows={3} value={domains ?? local.blocked_domains.join('\n')} onChange={e => setDomains(e.target.value)}
            placeholder="exemple.com" className={`${inputCls} resize-none font-mono`} />
        </Field>
      </Section>
      <button onClick={submit} disabled={save.isPending} className={btnCls}>{t('common.save')}</button>
    </div>
  )
}
