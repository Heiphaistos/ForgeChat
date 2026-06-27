import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  User, Palette, Bell, Mic, Shield, Cpu, LogOut, X, ChevronLeft,
  Camera, Globe, Accessibility, Link, Keyboard, Film, Monitor, Video, BarChart3, Mail, Clock,
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

type Section =
  | 'account' | 'profile' | 'appearance' | 'text_display'
  | 'notifications' | 'notifications_email' | 'audio' | 'video' | 'privacy' | 'language'
  | 'accessibility' | 'streamer' | 'connected' | 'keybindings' | 'advanced' | 'security' | 'sessions'
  | 'stats' | 'login_history'

const NAV: { id: Section; label: string; icon: React.ReactNode; group?: string }[] = [
  { id: 'account', label: 'Mon compte', icon: <User size={16} />, group: 'Compte' },
  { id: 'profile', label: 'Profil utilisateur', icon: <Camera size={16} /> },
  { id: 'connected', label: 'Comptes connectés', icon: <Link size={16} /> },
  { id: 'appearance', label: 'Apparence', icon: <Palette size={16} />, group: 'Application' },
  { id: 'text_display', label: 'Texte & Affichage', icon: <Monitor size={16} /> },
  { id: 'notifications', label: 'Notifications', icon: <Bell size={16} /> },
  { id: 'notifications_email', label: 'Emails', icon: <Mail size={16} /> },
  { id: 'keybindings', label: 'Raccourcis clavier', icon: <Keyboard size={16} /> },
  { id: 'language', label: 'Langue & Région', icon: <Globe size={16} /> },
  { id: 'audio', label: 'Audio', icon: <Mic size={16} />, group: 'Voix & Vidéo' },
  { id: 'video', label: 'Vidéo', icon: <Video size={16} /> },
  { id: 'privacy', label: 'Vie privée', icon: <Shield size={16} />, group: 'Confidentialité' },
  { id: 'security', label: 'Sécurité', icon: <Shield size={16} /> },
  { id: 'sessions', label: 'Sessions', icon: <Monitor size={16} /> },
  { id: 'login_history', label: 'Connexions', icon: <Clock size={16} /> },
  { id: 'accessibility', label: 'Accessibilité', icon: <Accessibility size={16} /> },
  { id: 'streamer', label: 'Mode Streamer', icon: <Film size={16} /> },
  { id: 'advanced', label: 'Avancé', icon: <Cpu size={16} />, group: 'Avancé' },
  { id: 'stats', label: 'Statistiques', icon: <BarChart3 size={16} /> },
]

import React from 'react'

export default function SettingsPage() {
  const { user, updateMe, logout } = useAuth()
  const nav = useNavigate()
  const [section, setSection] = useState<Section>('account')
  // Mobile : on affiche d'abord la nav, puis le contenu
  const [mobileShowContent, setMobileShowContent] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') nav(-1) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [nav])

  if (!user) return null

  const currentLabel = NAV.find(n => n.id === section)?.label ?? ''

  const handleSelectSection = (id: Section) => {
    setSection(id)
    setMobileShowContent(true)
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
          <h1 className="text-sm font-semibold text-fc-muted uppercase tracking-wide">Paramètres</h1>
          <button
            onClick={() => nav(-1)}
            className="p-1.5 text-fc-muted hover:text-white rounded-lg hover:bg-fc-hover transition"
            title="Fermer (Échap)"
          >
            <X size={16} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          {NAV.map((item, idx) => (
            <div key={item.id}>
              {(idx === 0 || item.group) && (
                <div className={`px-3 pt-3 pb-1 text-xs font-semibold text-fc-muted uppercase tracking-wide ${idx > 0 ? 'mt-1 border-t border-fc-hover' : ''}`}>
                  {item.group}
                </div>
              )}
              <button
                onClick={() => handleSelectSection(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition mb-0.5
                  ${section === item.id
                    ? 'bg-fc-hover text-white'
                    : 'text-fc-muted hover:bg-fc-hover hover:text-white'}`}
              >
                {item.icon}
                {item.label}
              </button>
            </div>
          ))}

          <div className="border-t border-fc-hover my-2" />
          <button
            onClick={async () => { await logout(); nav('/login') }}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-fc-red hover:bg-fc-red/10 transition"
          >
            <LogOut size={16} /> Déconnexion
          </button>
        </nav>

        <div className="p-3 border-t border-fc-hover text-xs text-fc-muted text-center">ForgeChat v3.62.0</div>
      </div>

      {/* Content — masqué sur mobile tant que pas de section choisie */}
      <div className={`
        flex-1 overflow-y-auto
        ${!mobileShowContent ? 'hidden md:block' : 'block'}
      `}>
        <div className="max-w-2xl mx-auto px-4 md:px-8 py-8 pb-20">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-2">
              {/* Retour mobile */}
              <button
                onClick={() => setMobileShowContent(false)}
                className="md:hidden p-1.5 text-fc-muted hover:text-white rounded-lg hover:bg-fc-hover transition -ml-1"
                title="Retour"
              >
                <ChevronLeft size={20} />
              </button>
              <h2 className="text-xl font-bold text-white">{currentLabel}</h2>
            </div>
            <button
              onClick={() => nav(-1)}
              className="p-2 text-fc-muted hover:text-white rounded-lg hover:bg-fc-hover transition"
              title="Fermer"
            >
              <X size={20} />
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
        </div>
      </div>
    </div>
  )
}
