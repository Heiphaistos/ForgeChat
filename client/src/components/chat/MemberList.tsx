import { useQuery } from '@tanstack/react-query'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useSwipeRightToClose } from '../../hooks/useSwipeClose'
import { useNavigate } from 'react-router-dom'
import api, { mediaUrl } from '../../api/client'
import toast from 'react-hot-toast'
import { usePresence } from '../../store/presence'
import { useContextMenu } from '../ui/ContextMenu'
import UserPopup from '../UserPopup'
import { useMemberModeration } from './MemberModeration'

interface Props {
  serverId: string
  onClose?: () => void
}

// Virtualisation maison : hauteurs fixes, seules les lignes proches de la zone
// visible sont montées (un serveur de plusieurs milliers de membres restait
// entièrement dans le DOM).
const ROW_H = 48
const HEADER_H = 32
const OVERSCAN_PX = 400

type ListItem =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'member'; key: string; m: any }

const STATUS_COLORS: Record<string, string> = {
  online: 'bg-fc-green',
  idle: 'bg-fc-yellow',
  dnd: 'bg-fc-red',
  offline: 'bg-fc-muted',
  invisible: 'bg-fc-muted',
}

const STATUS_LABELS: Record<string, string> = {
  online: 'En ligne',
  idle: 'Absent',
  dnd: 'Ne pas déranger',
  offline: 'Hors ligne',
  invisible: 'Invisible',
}

function MemberRow({ m, onClick, onContextMenu, onLongPress }: { m: any; onClick: (e: React.MouseEvent) => void; onContextMenu: (e: React.MouseEvent) => void; onLongPress: (x: number, y: number) => void }) {
  const statusLabel = STATUS_LABELS[m.liveStatus] ?? 'Hors ligne'
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  return (
    <div
      role="listitem"
      aria-label={`${m.nickname ?? m.username} — ${statusLabel}${m.is_owner ? ' (propriétaire)' : ''}`}
      style={{ height: ROW_H }}
      className="flex items-center gap-2 px-2 rounded hover:bg-fc-hover group cursor-pointer transition"
      onClick={onClick}
      onContextMenu={onContextMenu}
      onTouchStart={e => {
        const { clientX, clientY } = e.touches[0]
        longPressTimer.current = setTimeout(() => {
          longPressTimer.current = null
          if ('vibrate' in navigator) navigator.vibrate(20)
          onLongPress(clientX, clientY)
        }, 500)
      }}
      onTouchEnd={() => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null } }}
      onTouchCancel={() => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null } }}
      onTouchMove={() => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null } }}
    >
      <div className="relative flex-shrink-0">
        <div className="w-8 h-8 rounded-full bg-fc-accent flex items-center justify-center font-semibold text-sm text-white overflow-hidden">
          {m.avatar
            ? <img src={mediaUrl(m.avatar)} alt={m.nickname ?? m.username} loading="lazy" decoding="async" className="w-full h-full rounded-full object-cover" />
            : (m.nickname ?? m.username).charAt(0).toUpperCase()}
        </div>
        <div
          className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-fc-channel ${STATUS_COLORS[m.liveStatus] ?? 'bg-fc-muted'}`}
          aria-label={statusLabel}
          title={statusLabel}
        />
      </div>
      <div className="min-w-0">
        <div className={`text-sm font-medium truncate ${m.liveStatus === 'offline' || m.liveStatus === 'invisible' ? 'text-fc-muted' : 'text-fc-text group-hover:text-white'}`}>
          {m.nickname ?? m.username}
          {m.is_owner && <span aria-hidden className="ml-1 text-xs text-fc-yellow">👑</span>}
        </div>
        {m.activity_type && m.activity_name ? (
          <div className="text-xs text-fc-muted truncate flex items-center gap-1" aria-label={`${m.activity_type === 'playing' ? 'Joue à' : m.activity_type === 'listening' ? 'Écoute' : m.activity_type === 'watching' ? 'Regarde' : 'Activité'} ${m.activity_name}`}>
            <span aria-hidden>
              {m.activity_type === 'playing' ? '🎮' :
               m.activity_type === 'listening' ? '🎵' :
               m.activity_type === 'watching' ? '📺' :
               m.activity_type === 'streaming' ? '📡' : '🏆'}
            </span>
            <span className="truncate">{m.activity_name}</span>
          </div>
        ) : m.custom_status ? (
          <div className="text-xs text-fc-muted truncate">{m.custom_status}</div>
        ) : null}
      </div>
    </div>
  )
}

export default function MemberList({ serverId, onClose }: Props) {
  const { data: members = [] } = useQuery({
    queryKey: ['members', serverId],
    queryFn: () => api.get(`/servers/${serverId}/members`).then(r => r.data),
    // Plus de rechargement périodique : la présence arrive par WS (usePresence) et
    // App.tsx invalide ['members', serverId] sur MEMBER_JOIN/LEAVE/REMOVE/KICKED/
    // BANNED/UNBAN/ROLE_UPDATE/NICKNAME_UPDATE/TIMEOUT et USER_UPDATE.
    staleTime: 5 * 60_000,
  })

  const presenceStatuses = usePresence(s => s.statuses)
  // Activité en direct (WS) : remplace l'ancien rechargement toutes les 30 s
  const presenceActivities = usePresence(s => s.activities)
  const getStatus = (id: string) => presenceStatuses[id] ?? 'offline'
  const ctxMenu = useContextMenu()
  const nav = useNavigate()
  // Expulser / Bannir / Timeout / Notes / vocal selon les permissions réelles
  // et la hiérarchie (avant : « Expulser » réservé au seul propriétaire).
  const moderation = useMemberModeration(serverId)
  const [popup, setPopup] = useState<{ userId: string; x: number; y: number } | null>(null)

  const { online, offline } = useMemo(() => {
    const withStatus = (members as any[]).map((m: any) => {
      const act = presenceActivities[m.user_id]
      return {
        ...m,
        ...(act ? { activity_type: act.activity_type, activity_name: act.activity_name } : {}),
        liveStatus: getStatus(m.user_id) ?? m.status ?? 'offline',
      }
    })
    return {
      online: withStatus.filter((m: any) =>
        m.liveStatus === 'online' || m.liveStatus === 'idle' || m.liveStatus === 'dnd'
      ),
      offline: withStatus.filter((m: any) =>
        m.liveStatus === 'offline' || m.liveStatus === 'invisible'
      ),
    }
  }, [members, presenceStatuses, presenceActivities])

  const menuItems = (m: any) => [
    { label: 'Voir le profil', onClick: () => nav(`/users/${m.user_id}`) },
    { label: 'Envoyer un message', onClick: () => {
      // Route réelle : POST /dms/:user_id (id en path, pas de body), réponse
      // { dm_id } -- l'ancien code postait sur /dms (route inexistante, seul
      // GET /dms existe) et lisait r.data.id (jamais présent) : le clic
      // n'ouvrait jamais de DM, sans le moindre message d'erreur (catch muet).
      api.post(`/dms/${m.user_id}`)
        .then(r => nav(`/dms/${r.data.dm_id}`))
        .catch(() => toast.error("Impossible d'ouvrir la conversation"))
    }},
    { label: 'Mentionner', onClick: () => {
      const el = document.querySelector<HTMLTextAreaElement>('textarea[data-message-input]')
      if (el) {
        const pos = el.selectionStart ?? el.value.length
        // Pseudo (et non le surnom) + jeton <@id> enregistré par MessageInput :
        // le message part avec une vraie mention qui notifie.
        window.dispatchEvent(new CustomEvent('forgechat:mention-picked', { detail: { name: m.username, token: `<@${m.user_id}>` } }))
        const mention = `@${m.username} `
        const newVal = el.value.slice(0, pos) + mention + el.value.slice(pos)
        el.focus()
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
        setter?.call(el, newVal)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        const newPos = pos + mention.length
        setTimeout(() => el.setSelectionRange(newPos, newPos), 0)
      }
    }},
    { separator: true as const },
    { label: 'Copier l\'ID', onClick: () => navigator.clipboard.writeText(m.user_id) },
    ...moderation.itemsFor(m.user_id),
  ]

  const [search, setSearch] = useState('')
  const swipe = useSwipeRightToClose(() => onClose?.())
  const query = search.trim().toLowerCase()
  const filteredOnline = useMemo(
    () => query ? online.filter((m: any) => (m.nickname ?? m.username).toLowerCase().includes(query)) : online,
    [online, query])
  const filteredOffline = useMemo(
    () => query ? offline.filter((m: any) => (m.nickname ?? m.username).toLowerCase().includes(query)) : offline,
    [offline, query])

  // Liste aplatie (titres de groupe + membres) avec la position verticale de chaque élément
  const { items, offsets, totalHeight } = useMemo(() => {
    const items: ListItem[] = []
    if (filteredOnline.length > 0) {
      items.push({ kind: 'header', key: 'h-online', label: `En ligne — ${filteredOnline.length}` })
      for (const m of filteredOnline) items.push({ kind: 'member', key: m.user_id, m })
    }
    if (filteredOffline.length > 0) {
      items.push({ kind: 'header', key: 'h-offline', label: `Hors ligne — ${filteredOffline.length}` })
      for (const m of filteredOffline) items.push({ kind: 'member', key: m.user_id, m })
    }
    const offsets: number[] = []
    let y = 0
    for (const it of items) { offsets.push(y); y += it.kind === 'header' ? HEADER_H : ROW_H }
    return { items, offsets, totalHeight: y }
  }, [filteredOnline, filteredOffline])

  const scrollRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ top: 0, height: 1200 })
  const measure = useCallback(() => {
    const el = scrollRef.current
    const list = listRef.current
    if (!el || !list) return
    setView({ top: el.scrollTop - list.offsetTop, height: el.clientHeight })
  }, [])
  useLayoutEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  const minY = view.top - OVERSCAN_PX
  const maxY = view.top + view.height + OVERSCAN_PX
  const visible: number[] = []
  for (let i = 0; i < items.length; i++) {
    const h = items[i].kind === 'header' ? HEADER_H : ROW_H
    if (offsets[i] + h < minY) continue
    if (offsets[i] > maxY) break
    visible.push(i)
  }

  return (
    <div
      {...swipe}
      ref={scrollRef}
      onScroll={measure}
      role="complementary"
      aria-label="Liste des membres"
      className="absolute inset-0 z-10 lg:relative lg:inset-auto lg:z-auto w-full lg:w-60 bg-fc-channel flex-shrink-0 overflow-y-auto overscroll-y-contain p-2 panel-slide-right"
    >
      {/* Header mobile avec fermeture (la liste est un overlay plein écran) */}
      <div className="lg:hidden flex items-center justify-between px-2 py-2 border-b border-fc-bg mb-2">
        <span className="font-semibold text-white text-sm">Membres</span>
        <button
          onClick={onClose}
          aria-label="Fermer la liste des membres"
          className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-fc-muted hover:text-white rounded hover:bg-fc-hover transition"
        >
          <X size={16} aria-hidden />
        </button>
      </div>
      <div className="px-1 pb-2">
        <input
          type="search"
          placeholder="Rechercher un membre…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Rechercher un membre"
          className="w-full bg-fc-bg/60 text-fc-text placeholder-fc-muted text-xs px-2.5 py-1.5 rounded outline-none focus:ring-1 focus:ring-fc-accent/50 transition"
        />
      </div>
      <div ref={listRef} role="list" aria-label="Membres" style={{ position: 'relative', height: totalHeight }}>
        {visible.map(i => {
          const it = items[i]
          return (
            <div key={it.key} style={{ position: 'absolute', top: offsets[i], left: 0, right: 0 }}>
              {it.kind === 'header' ? (
                <div
                  role="listitem"
                  style={{ height: HEADER_H }}
                  className="px-2 pb-1 flex items-end text-xs font-semibold text-fc-muted uppercase tracking-wide"
                >
                  {it.label}
                </div>
              ) : (
                <MemberRow m={it.m} onClick={e => setPopup({ userId: it.m.user_id, x: e.clientX - 280, y: e.clientY })} onContextMenu={e => ctxMenu.open(e, menuItems(it.m))} onLongPress={(x, y) => ctxMenu.openAt(x, y, menuItems(it.m))} />
              )}
            </div>
          )
        })}
      </div>
      {query && filteredOnline.length === 0 && filteredOffline.length === 0 && (
        <p className="text-xs text-fc-muted px-2 py-4 text-center">Aucun membre trouvé</p>
      )}
      {ctxMenu.node}
      {moderation.node}
      {popup && (
        <UserPopup userId={popup.userId} serverId={serverId} anchorX={popup.x} anchorY={popup.y} onClose={() => setPopup(null)} />
      )}
    </div>
  )
}
