// Liste d'amis organisée (lot « Profil et social ») : favoris épinglés en haut,
// groupes d'amis (créer, renommer, trier, supprimer), anniversaires à venir et
// statut riche de chaque ami.
import { useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Pencil, Pin, PinOff, Trash2, Users } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../api/client'
import { usePresence } from '../../store/presence'
import { useT } from '../../i18n'
import RichStatus from '../ui/RichStatus'
import { upcomingBirthdays, type DayMonth } from '../../utils/birthday'
import { dayMonthLabel } from '../UserSocialInfo'

export interface SocialFriend {
  id: string
  friend_id: string
  username: string
  custom_nickname?: string | null
  custom_status?: string | null
  is_favorite?: boolean
  birthday?: DayMonth | null
  activity_type?: string | null
  activity_name?: string | null
  in_call?: boolean
}

interface FriendGroup { id: string; name: string; position: number; member_ids: string[] }

const GROUPS_KEY = ['friend-groups']

function useGroups() {
  return useQuery<FriendGroup[]>({ queryKey: GROUPS_KEY, queryFn: () => api.get('/friends/groups').then(r => r.data) })
}

function useGroupMutation<T>(fn: (v: T) => Promise<unknown>) {
  const qc = useQueryClient()
  const t = useT()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => { qc.invalidateQueries({ queryKey: GROUPS_KEY }); qc.invalidateQueries({ queryKey: ['friends'] }) },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('soc.groups.error')),
  })
}

/** Ligne de statut d'un ami : activité / appel en direct, sinon statut perso. */
export function FriendStatusLine({ friend, fallback }: { friend: SocialFriend; fallback: string }) {
  const live = usePresence(s => s.activities[friend.friend_id])
  const activity = live ?? friend
  const today = friend.birthday && upcomingBirthdays([friend], 0).length > 0
  return (
    <div className="text-xs text-fc-muted truncate mt-0.5 flex items-center gap-1">
      {today && <span title="🎂" aria-hidden>🎂</span>}
      {(activity.activity_type && activity.activity_name) || activity.in_call
        ? <RichStatus activity={activity} />
        : <span className="truncate">{friend.custom_status ?? fallback}</span>}
    </div>
  )
}

/** Entrées du menu « … » d'un ami : épingler, ranger dans des groupes. */
export function FriendMenuExtras({ friend }: { friend: SocialFriend }) {
  const t = useT()
  const { data: groups = [] } = useGroups()
  const pin = useGroupMutation((favorite: boolean) => api.put(`/friends/${friend.friend_id}/favorite`, { favorite }))
  const toggle = useGroupMutation(({ g, on }: { g: string; on: boolean }) => on
    ? api.post(`/friends/groups/${g}/members`, { user_id: friend.friend_id })
    : api.delete(`/friends/groups/${g}/members/${friend.friend_id}`))
  return (
    <>
      <button onClick={() => pin.mutate(!friend.is_favorite)}
        className="flex items-center gap-2 w-full px-3 py-2 text-sm text-fc-text hover:bg-fc-hover transition">
        {friend.is_favorite ? <PinOff size={14} /> : <Pin size={14} />} {t(friend.is_favorite ? 'soc.fav.unpin' : 'soc.fav.pin')}
      </button>
      {groups.length > 0 && (
        <fieldset className="px-3 py-1 border-t border-fc-hover">
          <legend className="text-[10px] uppercase text-fc-muted">{t('soc.groups.in')}</legend>
          {groups.map(g => (
            <label key={g.id} className="flex items-center gap-2 py-0.5 text-sm text-fc-text">
              <input type="checkbox" checked={g.member_ids.includes(friend.friend_id)}
                onChange={e => toggle.mutate({ g: g.id, on: e.target.checked })} />
              <span className="truncate">{g.name}</span>
            </label>
          ))}
        </fieldset>
      )}
    </>
  )
}

function GroupManager({ groups }: { groups: FriendGroup[] }) {
  const t = useT()
  const [name, setName] = useState('')
  const create = useGroupMutation((n: string) => api.post('/friends/groups', { name: n }))
  const rename = useGroupMutation(({ id, n }: { id: string; n: string }) => api.put(`/friends/groups/${id}`, { name: n }))
  const remove = useGroupMutation((id: string) => api.delete(`/friends/groups/${id}`))
  const order = useGroupMutation((ids: string[]) => api.put('/friends/groups/order', { ids }))
  const move = (i: number, d: -1 | 1) => {
    const ids = groups.map(g => g.id)
    if (i + d < 0 || i + d >= ids.length) return
    ;[ids[i], ids[i + d]] = [ids[i + d], ids[i]]
    order.mutate(ids)
  }
  return (
    <div className="mb-4 p-3 bg-fc-channel rounded-xl border border-fc-hover space-y-2 max-w-2xl">
      {groups.length === 0 && <p className="text-xs text-fc-muted">{t('soc.groups.empty')}</p>}
      {groups.map((g, i) => (
        <div key={g.id} className="flex items-center gap-1 text-sm text-fc-text">
          <span className="flex-1 truncate">{g.name} <span className="text-fc-muted text-xs">({g.member_ids.length})</span></span>
          <button aria-label={t('soc.groups.up')} title={t('soc.groups.up')} onClick={() => move(i, -1)} disabled={i === 0} className="p-1 hover:text-white disabled:opacity-30"><ArrowUp size={14} /></button>
          <button aria-label={t('soc.groups.down')} title={t('soc.groups.down')} onClick={() => move(i, 1)} disabled={i === groups.length - 1} className="p-1 hover:text-white disabled:opacity-30"><ArrowDown size={14} /></button>
          <button aria-label={t('soc.groups.rename')} title={t('soc.groups.rename')} className="p-1 hover:text-white"
            onClick={() => { const n = window.prompt(t('soc.groups.rename'), g.name)?.trim(); if (n) rename.mutate({ id: g.id, n }) }}><Pencil size={14} /></button>
          <button aria-label={t('soc.groups.delete')} title={t('soc.groups.delete')} onClick={() => remove.mutate(g.id)} className="p-1 hover:text-fc-red"><Trash2 size={14} /></button>
        </div>
      ))}
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (name.trim()) { create.mutate(name.trim()); setName('') } }}>
        <input value={name} onChange={e => setName(e.target.value)} maxLength={64} placeholder={t('soc.groups.namePh')}
          aria-label={t('soc.groups.namePh')} className="flex-1 px-2 py-1 bg-fc-input rounded text-sm text-white outline-none focus:ring-1 focus:ring-fc-accent" />
        <button type="submit" disabled={!name.trim() || create.isPending} className="px-3 py-1 bg-fc-accent text-white rounded text-sm disabled:opacity-40">{t('soc.groups.create')}</button>
      </form>
    </div>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (count === 0) return null
  return (
    <section className="mb-3">
      <h3 className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1">{title} — {count}</h3>
      <div className="space-y-0.5">{children}</div>
    </section>
  )
}

/** Amis rangés : anniversaires à venir, favoris, groupes dans l'ordre choisi, puis les autres. */
export default function FriendSections<F extends SocialFriend>({ friends, all, renderCard }: {
  friends: F[]
  /** Tous les amis (anniversaires), même hors du filtre en cours. */
  all: F[]
  renderCard: (f: F) => ReactNode
}) {
  const t = useT()
  const { data: groups = [] } = useGroups()
  const [managing, setManaging] = useState(false)
  const birthdays = useMemo(() => upcomingBirthdays(all, 7), [all])
  const sections = useMemo(() => {
    const placed = new Set<string>()
    const favorites = friends.filter(f => f.is_favorite)
    favorites.forEach(f => placed.add(f.friend_id))
    const byGroup = groups.map(g => {
      const list = friends.filter(f => g.member_ids.includes(f.friend_id) && !f.is_favorite)
      list.forEach(f => placed.add(f.friend_id))
      return { g, list }
    })
    return { favorites, byGroup, others: friends.filter(f => !placed.has(f.friend_id)) }
  }, [friends, groups])

  return (
    <>
      <div className="flex items-center gap-2 mb-2">
        <button onClick={() => setManaging(m => !m)} aria-expanded={managing}
          className="flex items-center gap-1.5 px-2 py-1 rounded text-xs bg-fc-hover text-fc-text hover:text-white">
          <Users size={12} /> {t('soc.groups.manage')}
        </button>
      </div>
      {managing && <GroupManager groups={groups} />}
      {birthdays.length > 0 && (
        <div className="mb-3 p-3 rounded-xl bg-fc-channel border border-fc-hover max-w-2xl">
          <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1">🎂 {t('soc.bday.upcoming')}</div>
          <ul className="text-sm text-fc-text space-y-0.5">
            {birthdays.map(({ friend, days }) => (
              <li key={friend.friend_id}>
                <span className="font-medium text-white">{friend.custom_nickname || friend.username}</span>
                {' — '}{days === 0 ? t('soc.bday.today') : dayMonthLabel(friend.birthday!)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Section title={t('soc.fav.section')} count={sections.favorites.length}>{sections.favorites.map(renderCard)}</Section>
      {sections.byGroup.map(({ g, list }) => (
        <Section key={g.id} title={g.name} count={list.length}>{list.map(renderCard)}</Section>
      ))}
      {sections.others.length > 0 && (sections.favorites.length > 0 || sections.byGroup.some(s => s.list.length > 0))
        ? <Section title={t('soc.groups.others')} count={sections.others.length}>{sections.others.map(renderCard)}</Section>
        : <div className="space-y-0.5">{sections.others.map(renderCard)}</div>}
    </>
  )
}
