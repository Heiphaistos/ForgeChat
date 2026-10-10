// Centre de notifications : pour chaque serveur, ce qui notifie (niveau,
// sourdine, @everyone, rôles, forums, catégories, salons réglés à part), et
// les messages privés. Hiérarchie : salon > catégorie > serveur > défaut,
// appliquée par le serveur (notify.rs) et par l'appli (store/channelNotif.ts).
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, ChevronDown, ChevronLeft, RotateCcw, AtSign, Settings, X } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { mediaUrl } from '../api/client'
import { useChannelNotif, resolveLevel, type NotifLevel } from '../store/channelNotif'
import { MuteSelect, muteRequest, type MuteChoice } from '../components/modals/muteOptions'
import { confirm } from '../components/ui/ConfirmModal'
import { useMobile } from '../contexts/MobileContext'
import { useT, intlLocale, type Key } from '../i18n'

interface Server { id: string; name: string; icon?: string | null; default_notification_level?: string }
interface Category { id: string; name: string }
interface Dm { id: string; is_group: boolean; name?: string | null; username?: string; is_muted: boolean }

const LEVEL_LABEL: Record<NotifLevel, Key> = {
  inherit: 'notif.level.inherit',
  all: 'notif.level.all',
  mentions: 'notif.level.mentions',
  nothing: 'notif.level.nothing',
}
const LEVELS: NotifLevel[] = ['inherit', 'all', 'mentions', 'nothing']
const label = 'block text-[11px] text-fc-muted uppercase font-semibold tracking-wide mb-1'
const select = 'bg-fc-channel text-fc-text text-sm rounded px-2 py-1.5 border border-fc-hover'
const check = 'flex items-center gap-2 py-1 cursor-pointer text-sm text-fc-text'

export default function NotificationsPage() {
  const t = useT()
  const nav = useNavigate()
  const qc = useQueryClient()
  const { openSidebar } = useMobile()
  const refresh = useChannelNotif(s => s.fetch)
  const [busy, setBusy] = useState(false)
  useEffect(() => { refresh() }, [refresh])

  const { data: servers = [] } = useQuery<Server[]>({
    queryKey: ['servers'],
    queryFn: () => api.get('/servers').then(r => r.data),
    staleTime: 30_000,
  })

  const run = async (call: () => Promise<unknown>, done: Key) => {
    setBusy(true)
    try {
      await call()
      await refresh()
      qc.invalidateQueries({ queryKey: ['categories'] })
      toast.success(t(done))
    } catch {
      toast.error(t('notifCenter.saveError'))
    } finally {
      setBusy(false)
    }
  }
  const resetAll = async () => {
    if (!await confirm({ message: t('notifCenter.resetAllConfirm'), danger: true, confirmLabel: t('notifCenter.resetAll') })) return
    run(() => api.delete('/user/notification-overrides'), 'notifCenter.resetDone')
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-fc-bg">
      <div className="px-4 py-4 border-b border-fc-hover flex items-center gap-3">
        <button
          className="md:hidden flex items-center justify-center min-w-[44px] min-h-[44px] p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition flex-shrink-0"
          onClick={openSidebar}
          aria-label={t('common.back')}
        >
          <ChevronLeft size={20} />
        </button>
        <Bell size={20} className="text-fc-accent" aria-hidden />
        <h1 className="text-lg font-bold text-white">{t('notifCenter.title')}</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-6 max-w-3xl w-full">
        <p className="text-sm text-fc-muted">{t('notifCenter.intro')}</p>

        <div className="flex flex-wrap gap-2">
          <button
            disabled={busy}
            onClick={() => run(() => api.put('/user/notification-overrides/everywhere', { level: 'mentions' }), 'notifCenter.mentionsEverywhereDone')}
            className="flex items-center gap-1.5 px-3 py-2 rounded bg-fc-accent hover:bg-fc-accent/80 text-white text-sm font-medium disabled:opacity-50"
          >
            <AtSign size={14} aria-hidden /> {t('notifCenter.mentionsEverywhere')}
          </button>
          <button
            disabled={busy}
            onClick={resetAll}
            className="flex items-center gap-1.5 px-3 py-2 rounded bg-fc-channel hover:bg-fc-hover text-fc-text text-sm disabled:opacity-50"
          >
            <RotateCcw size={14} aria-hidden /> {t('notifCenter.resetAll')}
          </button>
          <button
            onClick={() => nav('/settings?section=notifications')}
            className="flex items-center gap-1.5 px-3 py-2 rounded bg-fc-channel hover:bg-fc-hover text-fc-text text-sm"
          >
            <Settings size={14} aria-hidden /> {t('notifCenter.general')}
          </button>
        </div>
        <p className="text-xs text-fc-muted -mt-4">{t('notifCenter.mentionsEverywhereDesc')}</p>

        <section aria-labelledby="nc-servers" className="space-y-2">
          <h2 id="nc-servers" className={label}>{t('notifCenter.servers')}</h2>
          {servers.length === 0 && <p className="text-sm text-fc-muted">{t('notifCenter.noServers')}</p>}
          {servers.map(s => <ServerRow key={s.id} server={s} />)}
        </section>

        <DmSection />
      </div>
    </div>
  )
}

function ServerRow({ server }: { server: Server }) {
  const t = useT()
  const n = useChannelNotif()
  const [open, setOpen] = useState(false)
  const id = server.id
  const level = n.serverLevels.get(id) ?? 'inherit'
  const muted = n.isServerMuted(id)
  const until = n.mutedServers.get(id) ?? null
  const suppressEveryone = n.suppressEveryone.has(id)
  const suppressRoles = n.suppressRoles.has(id)
  const forumPosts = n.forumPosts.has(id)
  const defaultLevel = resolveLevel(undefined, undefined, undefined, server.default_notification_level)
  const channels = [...n.channelInfo].filter(([ch, info]) =>
    info.serverId === id && (n.channelLevels.has(ch) || n.isMuted(ch)))
  const categoryCount = [...n.categoryServer.values()].filter(sv => sv === id).length

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['categories', id],
    queryFn: () => api.get(`/servers/${id}/categories`).then(r => r.data),
    enabled: open,
    staleTime: 60_000,
  })

  const save = async (patch: Partial<{ level: NotifLevel; mute: MuteChoice; suppressEveryone: boolean; suppressRoles: boolean; forumPosts: boolean }>) => {
    const next = { level, suppressEveryone, suppressRoles, forumPosts, mute: (muted ? 'keep' : 'off') as MuteChoice, ...patch }
    const { body, until: nextUntil } = muteRequest(next.mute, until)
    try {
      await api.post('/user/notification-overrides', {
        server_id: id, level: next.level, ...body,
        suppress_everyone: next.suppressEveryone, suppress_roles: next.suppressRoles, forum_posts: next.forumPosts,
      })
      n.setServerMuted(id, body.muted, nextUntil)
      n.setServerPrefs(id, next.level, next.suppressEveryone)
      n.setServerFlags(id, { suppressRoles: next.suppressRoles, forumPosts: next.forumPosts })
    } catch {
      toast.error(t('notifCenter.saveError'))
    }
  }
  const setCategory = async (categoryId: string, value: NotifLevel) => {
    try {
      await api.post(`/user/category-notif/${categoryId}`, { level: value })
      await n.fetch()
    } catch {
      toast.error(t('notifCenter.saveError'))
    }
  }
  const resetChannel = async (channelId: string) => {
    try {
      await api.post(`/user/channel-notif/${channelId}`, { level: 'inherit', muted: false })
      n.setLevel(channelId, 'inherit')
      n.setMuted(channelId, false)
    } catch {
      toast.error(t('notifCenter.saveError'))
    }
  }
  const resetServer = async () => {
    try {
      await api.delete('/user/notification-overrides', { params: { server_id: id } })
      await n.fetch()
      toast.success(t('notifCenter.resetDone'))
    } catch {
      toast.error(t('notifCenter.saveError'))
    }
  }

  const time = (ms: number) => new Date(ms).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' })
  const summary = [
    level === 'inherit' ? `${t(LEVEL_LABEL[defaultLevel])} (${t('notifCenter.default')})` : t(LEVEL_LABEL[level]),
    muted && (until ? t('notifCenter.mutedUntil', { time: time(until) }) : t('notifCenter.muted')),
    suppressEveryone && t('notifCenter.everyoneIgnored'),
    suppressRoles && t('notifCenter.rolesIgnored'),
    forumPosts && t('notifCenter.forumOn'),
    categoryCount + channels.length > 0 && t('notifCenter.custom', { n: categoryCount + channels.length }),
  ].filter(Boolean).join(' · ')

  return (
    <details
      className="group bg-fc-channel rounded-lg border border-fc-hover"
      onToggle={e => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="flex items-center gap-3 p-3 cursor-pointer list-none">
        <span className="w-9 h-9 rounded-full bg-fc-bg flex items-center justify-center overflow-hidden flex-shrink-0 text-xs text-fc-text">
          {server.icon ? <img src={mediaUrl(server.icon)} alt="" className="w-full h-full object-cover" /> : server.name.slice(0, 2)}
        </span>
        <span className="min-w-0">
          <span className="block text-sm text-white font-medium truncate">{server.name}</span>
          <span className={`block text-xs truncate ${muted || (level === 'inherit' ? defaultLevel : level) === 'nothing' ? 'text-fc-muted' : 'text-fc-text'}`}>{summary}</span>
        </span>
        <ChevronDown size={16} aria-hidden className="ml-auto flex-shrink-0 text-fc-muted transition-transform group-open:rotate-180" />
      </summary>

      {open && (
        <div className="px-3 pb-3 space-y-4 border-t border-fc-hover pt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`nc-level-${id}`} className={label}>{t('notifCenter.level')}</label>
              <select id={`nc-level-${id}`} value={level} onChange={e => save({ level: e.target.value as NotifLevel })} className={`${select} w-full`}>
                {LEVELS.map(l => (
                  <option key={l} value={l}>
                    {l === 'inherit' ? t('notifCenter.defaultIs', { level: t(LEVEL_LABEL[defaultLevel]) }) : t(LEVEL_LABEL[l])}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`nc-mute-${id}`} className={label}>{t('notif.serverMute')}</label>
              <MuteSelect id={`nc-mute-${id}`} value={muted ? 'keep' : 'off'} onChange={mute => save({ mute })} currentUntil={until} wasMuted={muted} />
            </div>
          </div>

          <div>
            <label className={check}>
              <input type="checkbox" checked={suppressEveryone} onChange={e => save({ suppressEveryone: e.target.checked })} className="accent-fc-accent" />
              {t('notif.suppress')}
            </label>
            <label className={check}>
              <input type="checkbox" checked={suppressRoles} onChange={e => save({ suppressRoles: e.target.checked })} className="accent-fc-accent" />
              {t('notifCenter.suppressRoles')}
            </label>
            <label className={check}>
              <input type="checkbox" checked={forumPosts} onChange={e => save({ forumPosts: e.target.checked })} className="accent-fc-accent" />
              {t('notifCenter.forumPosts')}
            </label>
          </div>

          <div>
            <span className={label}>{t('notifCenter.categories')} — {t('notifCenter.categoriesDesc')}</span>
            {categories.length === 0 && <p className="text-xs text-fc-muted">{t('notifCenter.noCategories')}</p>}
            <ul className="space-y-1">
              {categories.map(c => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <label htmlFor={`nc-cat-${c.id}`} className="text-sm text-fc-text truncate">{c.name}</label>
                  <select id={`nc-cat-${c.id}`} value={n.categoryLevels.get(c.id) ?? 'inherit'} onChange={e => setCategory(c.id, e.target.value as NotifLevel)} className={select}>
                    {LEVELS.map(l => <option key={l} value={l}>{t(LEVEL_LABEL[l])}</option>)}
                  </select>
                </li>
              ))}
            </ul>
          </div>

          {channels.length > 0 && (
            <div>
              <span className={label}>{t('notifCenter.channels')}</span>
              <ul className="space-y-1">
                {channels.map(([ch, info]) => (
                  <li key={ch} className="flex items-center justify-between gap-2 text-sm text-fc-text">
                    <span className="truncate">
                      #{info.name} — {[n.channelLevels.has(ch) && t(LEVEL_LABEL[n.getLevel(ch)]), n.isMuted(ch) && t('notifCenter.muted')].filter(Boolean).join(' · ')}
                    </span>
                    <button onClick={() => resetChannel(ch)} aria-label={t('notifCenter.channelReset', { name: info.name })} title={t('notifCenter.channelReset', { name: info.name })} className="p-1 rounded text-fc-muted hover:text-white hover:bg-fc-hover">
                      <X size={14} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button onClick={resetServer} className="flex items-center gap-1.5 text-xs text-fc-muted hover:text-white">
            <RotateCcw size={12} aria-hidden /> {t('notifCenter.resetServer')}
          </button>
        </div>
      )}
    </details>
  )
}

function DmSection() {
  const t = useT()
  const qc = useQueryClient()
  // Clé à part : la barre latérale garde son propre format de ['dms'].
  const { data: dms = [] } = useQuery<Dm[]>({
    queryKey: ['dms', 'notif'],
    queryFn: () => api.get('/dms').then(r => r.data),
    staleTime: 30_000,
  })
  const setMuted = async (dm: Dm, muted: boolean) => {
    try {
      await api.patch(`/dms/${dm.id}/settings`, { muted })
      qc.invalidateQueries({ queryKey: ['dms'] })
    } catch {
      toast.error(t('notifCenter.saveError'))
    }
  }
  const btn = (on: boolean) => `px-2.5 py-1 text-xs rounded ${on ? 'bg-fc-accent text-white' : 'text-fc-muted hover:text-white hover:bg-fc-hover'}`

  return (
    <section aria-labelledby="nc-dms" className="space-y-2">
      <h2 id="nc-dms" className={label}>{t('notifCenter.dms')}</h2>
      <p className="text-xs text-fc-muted">{t('notifCenter.dmsDesc')}</p>
      {dms.length === 0 && <p className="text-sm text-fc-muted">{t('notifCenter.noDms')}</p>}
      <ul className="bg-fc-channel rounded-lg border border-fc-hover divide-y divide-fc-hover">
        {dms.map(dm => {
          const name = dm.is_group ? (dm.name ?? t('dms.group')) : (dm.username ?? '')
          return (
            <li key={dm.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="text-sm text-fc-text truncate">{name}</span>
              <span role="group" aria-label={name} className="flex gap-1 flex-shrink-0">
                <button aria-pressed={!dm.is_muted} onClick={() => setMuted(dm, false)} className={btn(!dm.is_muted)}>{t('notifCenter.dmAll')}</button>
                <button aria-pressed={dm.is_muted} onClick={() => setMuted(dm, true)} className={btn(dm.is_muted)}>{t('notifCenter.dmNothing')}</button>
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
