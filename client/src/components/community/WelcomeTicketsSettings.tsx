// Réglages : message de bienvenue (carte générée par l'appli) et tickets natifs.
import { useQuery } from '@tanstack/react-query'
import api from '../../api/client'
import { useAuth } from '../../store/auth'
import { useT } from '../../i18n'
import { useRoles, useSetting } from './hooks'
import { renderWelcome } from './format'
import GeneratedCard from './GeneratedCard'
import { btnCls, ChannelSelect, Field, inputCls, Section } from './ui'

interface Props {
  server: { id: string; name: string }
  channels: { id: string; name: string; type?: string }[]
}

interface Welcome { enabled: boolean; channel_id: string | null; text: string }
interface Tickets { enabled: boolean; category_id: string | null; staff_role_ids: string[] }

function WelcomeSection({ server, channels }: Props) {
  const t = useT()
  const me = useAuth(s => s.user)
  const { local, setLocal, save } = useSetting<Welcome>(server.id, 'welcome', { enabled: false, channel_id: null, text: t('community.welcome.default') })
  const name = me?.username ?? 'Momo'
  return (
    <Section title={t('community.welcome.title')} desc={t('community.welcome.desc')} enabled={local.enabled}
      onToggle={v => setLocal({ ...local, enabled: v })}>
      <ChannelSelect label={t('community.welcome.channel')} value={local.channel_id} channels={channels}
        allowNone={t('community.none')} onChange={v => setLocal({ ...local, channel_id: v })} />
      <Field label={t('community.welcome.text')}>
        <textarea value={local.text} maxLength={500} rows={2} onChange={e => setLocal({ ...local, text: e.target.value })}
          className={`${inputCls} resize-none`} />
      </Field>
      <p className="text-xs text-fc-muted">{t('community.welcome.vars')}</p>
      <GeneratedCard data={{
        name, avatar: me?.avatar,
        title: t('community.welcome.cardTitle', { name }),
        subtitle: renderWelcome(local.text, name, server.name, 42),
        footer: t('community.welcome.memberNumber', { n: 42 }),
      }} />
      <button onClick={() => save.mutate(local)} disabled={save.isPending} className={btnCls}>{t('common.save')}</button>
    </Section>
  )
}

function TicketsSection({ server }: Props) {
  const t = useT()
  const { local, setLocal, save } = useSetting<Tickets>(server.id, 'tickets/settings', { enabled: false, category_id: null, staff_role_ids: [] })
  const { data: roles = [] } = useRoles(server.id)
  const { data: cats = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['categories', server.id],
    queryFn: () => api.get(`/servers/${server.id}/categories`).then(r => r.data),
  })
  const toggleRole = (id: string) => setLocal({
    ...local,
    staff_role_ids: local.staff_role_ids.includes(id) ? local.staff_role_ids.filter(x => x !== id) : [...local.staff_role_ids, id],
  })
  return (
    <Section title={t('community.tickets.title')} desc={t('community.tickets.desc')} enabled={local.enabled}
      onToggle={v => setLocal({ ...local, enabled: v })}>
      <Field label={t('community.tickets.category')}>
        <select value={local.category_id ?? ''} onChange={e => setLocal({ ...local, category_id: e.target.value || null })} className={inputCls}>
          <option value="">{t('community.none')}</option>
          {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <div>
        <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1">{t('community.tickets.staff')}</div>
        <div className="flex flex-wrap gap-1.5">
          {roles.filter(r => !r.is_everyone).map(r => (
            <button key={r.id} type="button" onClick={() => toggleRole(r.id)} aria-pressed={local.staff_role_ids.includes(r.id)}
              className={`px-2.5 py-1 rounded-full text-xs transition ${local.staff_role_ids.includes(r.id) ? 'bg-fc-accent text-white' : 'bg-fc-hover text-fc-muted hover:text-white'}`}>
              {r.name}
            </button>
          ))}
        </div>
      </div>
      <button onClick={() => save.mutate({ ...local, staff_role_ids: local.staff_role_ids })} disabled={save.isPending} className={btnCls}>{t('common.save')}</button>
    </Section>
  )
}

export default function WelcomeTicketsSettings(props: Props) {
  return (
    <>
      <WelcomeSection {...props} />
      <TicketsSection {...props} />
    </>
  )
}
