import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Search, Hash, User, Settings, MessageCircle, Plus,
  Compass, Clock, ChevronRight, X, Users, Bookmark, Keyboard, Mic,
} from 'lucide-react'
import api from '../api/client'
import { stripMarkdown } from '../utils/mdShortcuts'
import { useKeyboardNav } from '../hooks/useKeyboardNav'
import { messageLink } from '../utils/searchLink'
import { useT, useLang, type Key } from '../i18n'
import { SHORTCUTS, prettyCombo } from '../lib/shortcuts'
import { runShortcut, shortcutLabel, useShortcutBindings } from '../hooks/useShortcuts'


interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
}

interface PaletteItem {
  id: string
  category: string
  label: string
  sublabel?: string
  /** Raccourci clavier affiché à droite. */
  hint?: string
  icon: React.ReactNode
  action: () => void
}

interface SearchResult {
  channels: Array<{ id: string; name: string; server_id: string; server_name: string }>
  users: Array<{ id: string; username: string; status: string }>
  messages: Array<{
    id: string; content: string; channel_id: string
    server_id: string; author_username: string
  }>
}

interface RecentChannel {
  id: string; name: string; serverId: string; serverName: string
}

const RECENT_KEY = 'fc_recent_channels'
const MAX_RECENT = 5

export function pushRecentChannel(channel: RecentChannel) {
  try {
    const stored: RecentChannel[] = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    const filtered = stored.filter(c => c.id !== channel.id)
    localStorage.setItem(RECENT_KEY, JSON.stringify([channel, ...filtered].slice(0, MAX_RECENT)))
  } catch { /* localStorage indisponible */ }
}

function getRecentChannels(): RecentChannel[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') } catch { return [] }
}

// Réglages ouvrables depuis la palette : [section, libellé].
const SETTINGS_SECTIONS: [string, Key][] = [
  ['account', 'settings.section.account'], ['profile', 'settings.section.profile'],
  ['connected', 'settings.section.connected'], ['appearance', 'settings.section.appearance'],
  ['text_display', 'settings.section.textDisplay'], ['notifications', 'settings.section.notifications'],
  ['notifications_email', 'settings.section.emails'], ['keybindings', 'settings.section.keybindings'],
  ['language', 'settings.section.language'], ['audio', 'settings.section.audio'], ['video', 'settings.section.video'],
  ['privacy', 'settings.section.privacy'], ['security', 'settings.section.security'], ['sessions', 'settings.section.sessions'],
  ['login_history', 'settings.section.loginHistory'], ['accessibility', 'settings.section.accessibility'],
  ['streamer', 'settings.section.streamer'], ['advanced', 'settings.section.advanced'], ['stats', 'settings.section.stats'],
]

// La palette elle-même, le push-to-talk (touche maintenue) et le clip (page vocale) n'ont pas de sens ici ;
// le split n'existe que sur grand écran.
const PALETTE_HIDDEN = new Set(['search', 'push_to_talk', 'clip_stream',
  ...(typeof window !== 'undefined' && window.innerWidth < 768 ? ['toggle_split'] : [])])

// Recherche insensible aux accents et à la casse.
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

const STATUS_COLOR: Record<string, string> = {
  online: 'bg-green-500', idle: 'bg-yellow-500', dnd: 'bg-red-500', offline: 'bg-fc-muted',
}

export default function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const nav = useNavigate()
  const qc = useQueryClient()
  const t = useT()
  const lang = useLang(s => s.lang)
  const bindings = useShortcutBindings()

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 200)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    if (isOpen) {
      setQuery(''); setDebouncedQuery('')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen])

  const { data: searchResults } = useQuery<SearchResult>({
    queryKey: ['cmd_search', debouncedQuery],
    queryFn: () => api.get(`/search?q=${encodeURIComponent(debouncedQuery)}`).then(r => r.data),
    enabled: debouncedQuery.trim().length >= 2,
    staleTime: 10_000,
  })

  const navigate = useCallback((path: string) => { nav(path); onClose() }, [nav, onClose])

  // Serveurs de l'utilisateur (cache partagé avec le rail) — filtrés localement
  const { data: myServers = [] } = useQuery<any[]>({
    queryKey: ['servers'],
    queryFn: () => api.get('/servers').then(r => r.data),
    staleTime: 30_000,
  })

  const items: PaletteItem[] = []

  if (debouncedQuery.trim().length >= 2) {
    for (const srv of myServers.filter((s: any) => s.name?.toLowerCase().includes(debouncedQuery.toLowerCase())).slice(0, 5)) {
      items.push({
        id: `srv-${srv.id}`, category: t('palette.servers'), label: srv.name,
        icon: <Compass size={14} className="text-fc-muted" />,
        action: () => navigate(`/servers/${srv.id}`),
      })
    }
  }

  if (!debouncedQuery) {
    for (const ch of getRecentChannels()) {
      items.push({
        id: `recent-${ch.id}`, category: t('palette.recent'),
        label: `#${ch.name}`, sublabel: ch.serverName,
        icon: <Clock size={14} className="text-fc-muted" />,
        action: () => navigate(`/servers/${ch.serverId}/channels/${ch.id}`),
      })
    }
  }

  if (debouncedQuery.trim().length >= 2 && searchResults) {
    for (const ch of searchResults.channels ?? []) {
      items.push({
        id: `ch-${ch.id}`, category: t('palette.channels'), label: `#${ch.name}`, sublabel: ch.server_name,
        icon: <Hash size={14} className="text-fc-muted" />,
        action: () => navigate(`/servers/${ch.server_id}/channels/${ch.id}`),
      })
    }
    for (const u of searchResults.users ?? []) {
      items.push({
        id: `user-${u.id}`, category: t('palette.members'), label: `@${u.username}`,
        sublabel: t(u.status === 'online' ? 'palette.online' : 'palette.offline'),
        icon: (
          <div className="relative">
            <User size={14} className="text-fc-muted" />
            <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-fc-channel ${STATUS_COLOR[u.status] ?? 'bg-fc-muted'}`} />
          </div>
        ),
        action: () => navigate(`/users/${u.id}`),
      })
    }
    for (const msg of (searchResults.messages ?? []).slice(0, 3)) {
      const clean = stripMarkdown(msg.content ?? '')
      const preview = clean.length > 60 ? `${clean.slice(0, 60)}…` : clean
      items.push({
        id: `msg-${msg.id}`, category: t('palette.messages'), label: preview, sublabel: t('palette.by', { user: msg.author_username }),
        icon: <MessageCircle size={14} className="text-fc-muted" />,
        action: () => navigate(messageLink(msg)),
      })
    }
  }

  const q = norm(debouncedQuery.trim())
  const hit = (...texts: string[]) => !q || norm(texts.join(' ')).includes(q)
  const icon = (I: typeof Settings) => <I size={14} className="text-fc-muted" />

  // Salons de tous les serveurs déjà chargés (instantané, marche aussi hors ligne).
  if (q.length >= 2) {
    const seen = new Set(items.map(i => i.id))
    for (const [, data] of qc.getQueriesData<{ id?: string; name?: string; channels?: any[] }>({ queryKey: ['server'] })) {
      for (const ch of data?.channels ?? []) {
        if (items.length >= 40 || seen.has(`ch-${ch.id}`) || ch.type === 'category' || !hit(ch.name ?? '')) continue
        seen.add(`ch-${ch.id}`)
        items.push({
          id: `ch-${ch.id}`, category: t('palette.channels'), label: `#${ch.name}`, sublabel: data?.name,
          icon: icon(Hash), action: () => navigate(`/servers/${data?.id}/channels/${ch.id}`),
        })
      }
    }
  }

  const shortcutActions: PaletteItem[] = SHORTCUTS
    .filter(s => !PALETTE_HIDDEN.has(s.action))
    .map(s => ({
      id: `sc-${s.action}`, category: t('palette.actions'), label: t(shortcutLabel(s.action)),
      hint: prettyCombo(bindings[s.action], lang), icon: icon(s.group === 'voice' ? Mic : Keyboard),
      action: () => { onClose(); runShortcut(s.action) },
    }))

  const quickActions: PaletteItem[] = [
    { id: 'action-dm', category: t('palette.actions'), label: t('palette.newDm'), icon: icon(MessageCircle), action: () => navigate('/friends') },
    { id: 'action-friends', category: t('palette.actions'), label: t('palette.friends'), icon: icon(Users), action: () => navigate('/friends') },
    { id: 'action-saved', category: t('palette.actions'), label: t('palette.saved'), icon: icon(Bookmark), action: () => navigate('/saved') },
    { id: 'action-explore', category: t('palette.actions'), label: t('palette.discover'), icon: icon(Compass), action: () => navigate('/discovery') },
    { id: 'action-create', category: t('palette.actions'), label: t('palette.createServer'), icon: icon(Plus), action: () => { window.dispatchEvent(new CustomEvent('forgechat:create-server')); onClose() } },
    ...shortcutActions,
  ].filter(a => hit(a.label))

  const settingsItems: PaletteItem[] = q.length >= 2
    ? SETTINGS_SECTIONS
      .filter(([id, label]) => hit(t(label), t(`settings.keywords.${id}` as Key)))
      .map(([id, label]) => ({
        id: `set-${id}`, category: t('palette.settings'), label: t(label), icon: icon(Settings),
        action: () => navigate(`/settings?section=${id}`),
      }))
    : []

  const allItems = [...items, ...quickActions, ...settingsItems]

  const { activeIndex: selected, setActiveIndex: setSelected, handleKey: navKey } = useKeyboardNav(
    allItems,
    (item) => item.action(),
    isOpen,
  )

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selected}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return }
    navKey(e.nativeEvent)
  }

  if (!isOpen) return null

  const groups: Record<string, PaletteItem[]> = {}
  for (const item of allItems) {
    if (!groups[item.category]) groups[item.category] = []
    groups[item.category].push(item)
  }

  let flatIdx = 0

  const activeItemId = selected >= 0 && selected < allItems.length ? `cp-item-${allItems[selected].id}` : undefined

  return (
    <div className="fixed inset-0 bg-black/60 z-[100] flex items-start justify-center pt-16 md:pt-24 px-3 md:px-0" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('palette.title')}
        className="w-full max-w-lg bg-fc-channel border border-fc-hover rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-fc-hover">
          <Search size={18} className="text-fc-muted flex-shrink-0" aria-hidden />
          <input
            ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey} placeholder={t('palette.placeholder')}
            inputMode="search" autoComplete="off"
            enterKeyHint="search" autoCapitalize="none"
            role="combobox"
            aria-expanded={allItems.length > 0}
            aria-controls="cp-listbox"
            aria-activedescendant={activeItemId}
            aria-label={t('palette.placeholder')}
            className="flex-1 bg-transparent text-white placeholder-fc-muted outline-none text-sm"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label={t('palette.clear')} className="p-0.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition">
              <X size={14} />
            </button>
          )}
          <kbd className="text-xs text-fc-muted bg-fc-hover px-1.5 py-0.5 rounded" aria-hidden>{t('palette.esc')}</kbd>
        </div>

        <div id="cp-listbox" role="listbox" aria-label={t('palette.results')} ref={listRef} className="max-h-96 overflow-y-auto overscroll-contain py-2">
          {allItems.length === 0 && <div role="status" className="px-4 py-8 text-center text-fc-muted text-sm">{t('palette.empty')}</div>}
          {Object.entries(groups).map(([category, groupItems]) => (
            <div key={category} role="group" aria-label={category}>
              <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-fc-muted" aria-hidden>{category}</div>
              {groupItems.map(item => {
                const idx = flatIdx++
                const isSelected = idx === selected
                return (
                  <button
                    key={item.id}
                    id={`cp-item-${item.id}`}
                    role="option"
                    aria-selected={isSelected}
                    data-idx={idx}
                    onClick={item.action}
                    onMouseEnter={() => setSelected(idx)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition
                      ${isSelected ? 'bg-fc-accent/20 text-white' : 'text-fc-text hover:bg-fc-hover'}`}
                  >
                    <div className="flex-shrink-0 w-5 flex items-center justify-center" aria-hidden>{item.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{item.label}</div>
                      {item.sublabel && <div className="text-xs text-fc-muted truncate">{item.sublabel}</div>}
                    </div>
                    {item.hint
                      ? <kbd className="text-[10px] text-fc-muted bg-fc-hover px-1.5 py-0.5 rounded flex-shrink-0 font-mono">{item.hint}</kbd>
                      : <ChevronRight size={14} className="text-fc-muted flex-shrink-0 opacity-60" aria-hidden />}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        <div className="px-4 py-2 border-t border-fc-hover flex items-center gap-4 text-xs text-fc-muted" aria-hidden>
          <span><kbd className="bg-fc-hover px-1 rounded">↑↓</kbd> {t('palette.navigate')}</span>
          <span><kbd className="bg-fc-hover px-1 rounded">{t('palette.enter')}</kbd> {t('palette.open')}</span>
          <span><kbd className="bg-fc-hover px-1 rounded">{t('palette.esc')}</kbd> {t('palette.close')}</span>
        </div>
      </div>
    </div>
  )
}
