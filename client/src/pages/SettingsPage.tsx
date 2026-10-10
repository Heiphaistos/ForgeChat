import { useState, useEffect, useRef } from 'react'
import { usePageTitle } from '../hooks/usePageTitle'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  User, Palette, Bell, Mic, Shield, Cpu, LogOut, X, ChevronLeft,
  Camera, Globe, Accessibility, Link, Keyboard, Film, Monitor, Video, BarChart3, Mail, Clock,
  Search, Sparkles, Puzzle,
} from 'lucide-react'
import { useAuth } from '../store/auth'
import AppearanceSection from '../components/settings/AppearanceSection'
import ConnectedAccountsSection from '../components/settings/ConnectedAccountsSection'
import KeybindingsSection from '../components/settings/KeybindingsSection'
import AccountSection from '../components/settings/AccountSection'
import ProfileSection from '../components/settings/ProfileSection'
import TextDisplaySection from '../components/settings/TextDisplaySection'
import NotificationsSection from '../components/settings/NotificationsSection'
import AudioSection from '../components/settings/AudioSection'
import VideoSection from '../components/settings/VideoSection'
import PrivacySection from '../components/settings/PrivacySection'
import LanguageSection from '../components/settings/LanguageSection'
import AccessibilitySection from '../components/settings/AccessibilitySection'
import StreamerSection from '../components/settings/StreamerSection'
import AdvancedSection from '../components/settings/AdvancedSection'
import SecuritySection from '../components/settings/SecuritySection'
import SessionsSection from '../components/settings/SessionsSection'
import StatsSection from '../components/settings/StatsSection'
import NotificationsEmailSection from '../components/settings/NotificationsEmailSection'
import LoginHistorySection from '../components/settings/LoginHistorySection'
import AiSection from '../components/settings/AiSection'
import ExtrasSection from '../components/settings/ExtrasSection'
import { useT, type Key } from '../i18n'

type Section =
  | 'account' | 'profile' | 'appearance' | 'text_display'
  | 'notifications' | 'notifications_email' | 'audio' | 'video' | 'privacy' | 'language'
  | 'accessibility' | 'streamer' | 'connected' | 'keybindings' | 'advanced' | 'security' | 'sessions'
  | 'stats' | 'login_history' | 'ai' | 'extras'

// Libellés = clés de traduction (traduits au rendu)
const NAV: { id: Section; label: Key; icon: React.ReactNode; group?: Key }[] = [
  { id: 'account', label: 'settings.section.account', icon: <User size={16} />, group: 'settings.group.account' },
  { id: 'profile', label: 'settings.section.profile', icon: <Camera size={16} /> },
  { id: 'connected', label: 'settings.section.connected', icon: <Link size={16} /> },
  { id: 'appearance', label: 'settings.section.appearance', icon: <Palette size={16} />, group: 'settings.group.app' },
  { id: 'text_display', label: 'settings.section.textDisplay', icon: <Monitor size={16} /> },
  { id: 'notifications', label: 'settings.section.notifications', icon: <Bell size={16} /> },
  { id: 'notifications_email', label: 'settings.section.emails', icon: <Mail size={16} /> },
  { id: 'keybindings', label: 'settings.section.keybindings', icon: <Keyboard size={16} /> },
  { id: 'language', label: 'settings.section.language', icon: <Globe size={16} /> },
  { id: 'ai', label: 'settings.section.ai', icon: <Sparkles size={16} /> },
  { id: 'extras', label: 'settings.section.extras', icon: <Puzzle size={16} /> },
  { id: 'audio', label: 'settings.section.audio', icon: <Mic size={16} />, group: 'settings.group.voice' },
  { id: 'video', label: 'settings.section.video', icon: <Video size={16} /> },
  { id: 'privacy', label: 'settings.section.privacy', icon: <Shield size={16} />, group: 'settings.group.privacy' },
  { id: 'security', label: 'settings.section.security', icon: <Shield size={16} /> },
  { id: 'sessions', label: 'settings.section.sessions', icon: <Monitor size={16} /> },
  { id: 'login_history', label: 'settings.section.loginHistory', icon: <Clock size={16} /> },
  { id: 'accessibility', label: 'settings.section.accessibility', icon: <Accessibility size={16} /> },
  { id: 'streamer', label: 'settings.section.streamer', icon: <Film size={16} /> },
  { id: 'advanced', label: 'settings.section.advanced', icon: <Cpu size={16} />, group: 'settings.group.advanced' },
  { id: 'stats', label: 'settings.section.stats', icon: <BarChart3 size={16} /> },
]

// Mots-clés de recherche par section (contenu des réglages, pas seulement le titre) :
// clés settings.keywords.<section> du dictionnaire.

// Recherche insensible aux accents et à la casse
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')

import React from 'react'

export default function SettingsPage() {
  const t = useT()
  usePageTitle(t('settings.title'))
  const { user, updateMe, logout } = useAuth()
  const nav = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  // Deep-link : /settings?section=audio ouvre directement la section
  const [section, setSection] = useState<Section>(() => {
    const s = searchParams.get('section') as Section | null
    return s && NAV.some(n => n.id === s) ? s : 'account'
  })
  // Mobile : on affiche d'abord la nav, puis le contenu (directement si deep-link)
  const [mobileShowContent, setMobileShowContent] = useState(() => !!searchParams.get('section'))
  // Recherche dans les réglages (filtre la nav par titre + mots-clés)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Échap dans le champ de recherche rempli → vider au lieu de fermer
      if (document.activeElement === searchRef.current && searchRef.current?.value) {
        setQuery('')
        return
      }
      nav(-1)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [nav])

  const nq = norm(query.trim())
  const filteredNav = nq
    ? NAV.filter(item => norm(`${t(item.label)} ${t(`settings.keywords.${item.id}`)}`).includes(nq))
    : NAV

  if (!user) return null

  const currentKey = NAV.find(n => n.id === section)?.label
  const currentLabel = currentKey ? t(currentKey) : ''

  const handleSelectSection = (id: Section) => {
    setSection(id)
    setMobileShowContent(true)
    setSearchParams({ section: id }, { replace: true })
  }

  return (
    <div className="fixed inset-0 bg-fc-bg z-50 flex">
      {/* Sidebar nav — masquée sur mobile quand contenu affiché */}
      <div className={`
        flex flex-col flex-shrink-0 bg-fc-channel border-r border-fc-hover
        w-full md:w-64
        ${mobileShowContent ? 'hidden md:flex' : 'flex'}
      `}>
        <div className="p-4 border-b border-fc-hover flex items-center justify-between">
          <h1 className="text-sm font-semibold text-fc-muted uppercase tracking-wide">{t('settings.title')}</h1>
          <button
            onClick={() => nav(-1)}
            aria-label={t('settings.close')}
            className="p-1.5 text-fc-muted hover:text-white rounded-lg hover:bg-fc-hover transition"
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        {/* Recherche dans les réglages */}
        <div className="px-3 pt-3">
          <div className="flex items-center gap-2 bg-fc-input rounded-lg px-2.5 py-1.5 focus-within:ring-1 focus-within:ring-fc-accent transition">
            <Search size={14} className="text-fc-muted flex-shrink-0" aria-hidden />
            <input
              ref={searchRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && filteredNav.length > 0) handleSelectSection(filteredNav[0].id)
              }}
              placeholder={t('settings.search')}
              aria-label={t('settings.search')}
              autoComplete="off" autoCapitalize="none" inputMode="search" enterKeyHint="go"
              className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder-fc-muted outline-none"
            />
            {query && (
              <button
                onClick={() => { setQuery(''); searchRef.current?.focus() }}
                aria-label={t('settings.clearSearch')}
                className="text-fc-muted hover:text-white transition flex-shrink-0"
              >
                <X size={13} aria-hidden />
              </button>
            )}
          </div>
        </div>

        <nav aria-label={t('settings.navLabel')} className="flex-1 overflow-y-auto overscroll-contain p-2">
          {nq && filteredNav.length === 0 && (
            <p role="status" className="px-3 py-4 text-sm text-fc-muted text-center">
              {t('settings.noResult', { q: query.trim() })}
            </p>
          )}
          {filteredNav.map((item, idx) => (
            <div key={item.id}>
              {/* Groupes masqués pendant une recherche (liste plate filtrée) */}
              {!nq && (idx === 0 || item.group) && (
                <div className={`px-3 pt-3 pb-1 text-xs font-semibold text-fc-muted uppercase tracking-wide ${idx > 0 ? 'mt-1 border-t border-fc-hover' : ''}`}>
                  {item.group && t(item.group)}
                </div>
              )}
              <button
                onClick={() => handleSelectSection(item.id)}
                aria-current={section === item.id ? 'page' : undefined}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition mb-0.5
                  ${section === item.id
                    ? 'bg-fc-hover text-white'
                    : 'text-fc-muted hover:bg-fc-hover hover:text-white'}`}
              >
                <span aria-hidden>{item.icon}</span>
                {t(item.label)}
              </button>
            </div>
          ))}

          <div className="border-t border-fc-hover my-2" aria-hidden />
          <button
            onClick={async () => { await logout(); nav('/login') }}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-fc-red hover:bg-fc-red/10 transition"
          >
            <LogOut size={16} aria-hidden /> {t('settings.logout')}
          </button>
        </nav>

        <div className="p-3 border-t border-fc-hover text-xs text-fc-muted text-center" aria-hidden>ForgeChat v{__APP_VERSION__}</div>
      </div>

      {/* Content — masqué sur mobile tant que pas de section choisie */}
      <div
        role="region"
        aria-label={currentLabel}
        className={`
          flex-1 overflow-y-auto overscroll-contain
          ${!mobileShowContent ? 'hidden md:block' : 'block'}
        `}
      >
        <div className="max-w-2xl mx-auto px-4 md:px-8 py-8 pb-20">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-2">
              {/* Retour mobile */}
              <button
                onClick={() => setMobileShowContent(false)}
                aria-label={t('settings.backToNav')}
                className="md:hidden min-w-[44px] min-h-[44px] flex items-center justify-center p-1.5 text-fc-muted hover:text-white rounded-lg hover:bg-fc-hover transition -ml-1"
              >
                <ChevronLeft size={20} aria-hidden />
              </button>
              <h2 className="text-xl font-bold text-white">{currentLabel}</h2>
            </div>
            <button
              onClick={() => nav(-1)}
              aria-label={t('settings.close')}
              className="p-2 text-fc-muted hover:text-white rounded-lg hover:bg-fc-hover transition"
            >
              <X size={20} aria-hidden />
            </button>
          </div>

          {section === 'account' && <AccountSection user={user} updateMe={updateMe} />}
          {section === 'profile' && <ProfileSection user={user} updateMe={updateMe} />}
          {section === 'appearance' && <AppearanceSection />}
          {section === 'text_display' && <TextDisplaySection />}
          {section === 'notifications' && <NotificationsSection />}
          {section === 'notifications_email' && <NotificationsEmailSection />}
          {section === 'audio' && <AudioSection />}
          {section === 'video' && <VideoSection />}
          {section === 'privacy' && <PrivacySection />}
          {section === 'language' && <LanguageSection />}
          {section === 'accessibility' && <AccessibilitySection />}
          {section === 'streamer' && <StreamerSection />}
          {section === 'connected' && <ConnectedAccountsSection />}
          {section === 'keybindings' && <KeybindingsSection />}
          {section === 'advanced' && <AdvancedSection user={user} />}
          {section === 'security' && <SecuritySection />}
          {section === 'sessions' && <SessionsSection />}
          {section === 'login_history' && <LoginHistorySection />}
          {section === 'stats' && <StatsSection />}
          {section === 'ai' && <AiSection />}
          {section === 'extras' && <ExtrasSection />}
        </div>
      </div>
    </div>
  )
}
