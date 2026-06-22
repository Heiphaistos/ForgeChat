import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import {
  User, Palette, Bell, Mic, Shield, Cpu, LogOut, X,
  Camera, Eye, EyeOff, Globe, Accessibility, Film,
  Link, Keyboard, Monitor, Trash2,
} from 'lucide-react'
import { useAuth } from '../store/auth'
import api from '../api/client'
import toast from 'react-hot-toast'

import AppearanceSection from '../components/settings/AppearanceSection'
import TextDisplaySection from '../components/settings/TextDisplaySection'
import NotificationsSection from '../components/settings/NotificationsSection'
import AudioSection from '../components/settings/AudioSection'
import PrivacySection from '../components/settings/PrivacySection'
import LanguageSection from '../components/settings/LanguageSection'
import AccessibilitySection from '../components/settings/AccessibilitySection'
import StreamerSection from '../components/settings/StreamerSection'
import ConnectedAccountsSection from '../components/settings/ConnectedAccountsSection'
import KeybindingsSection from '../components/settings/KeybindingsSection'
import AdvancedSection from '../components/settings/AdvancedSection'

// ─── Types ────────────────────────────────────────────────────────────────────

type Section =
  | 'account' | 'profile' | 'privacy'
  | 'appearance' | 'text_display'
  | 'notifications' | 'audio'
  | 'language' | 'accessibility' | 'streamer'
  | 'connected' | 'keybindings' | 'advanced'

interface NavItem { id: Section; label: string; icon: React.ReactNode; group?: string }

const NAV: NavItem[] = [
  { id: 'account',       label: 'Compte',            icon: <User size={16} />,           group: 'MON COMPTE' },
  { id: 'profile',       label: 'Profil',             icon: <Camera size={16} /> },
  { id: 'privacy',       label: 'Confidentialité',    icon: <Shield size={16} /> },
  { id: 'appearance',    label: 'Apparence',          icon: <Palette size={16} />,        group: 'APPARENCE' },
  { id: 'text_display',  label: 'Texte & Affichage',  icon: <Monitor size={16} /> },
  { id: 'notifications', label: 'Notifications',      icon: <Bell size={16} />,           group: 'COMMUNICATION' },
  { id: 'audio',         label: 'Audio & Voix',       icon: <Mic size={16} /> },
  { id: 'language',      label: 'Langue & Région',    icon: <Globe size={16} />,          group: 'APPLICATION' },
  { id: 'accessibility', label: 'Accessibilité',      icon: <Accessibility size={16} /> },
  { id: 'streamer',      label: 'Mode Streamer',      icon: <Film size={16} /> },
  { id: 'connected',     label: 'Comptes connectés',  icon: <Link size={16} />,           group: 'AVANCÉ' },
  { id: 'keybindings',   label: 'Raccourcis clavier', icon: <Keyboard size={16} /> },
  { id: 'advanced',      label: 'Avancé',             icon: <Cpu size={16} /> },
]

// ─── Shared primitives ────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-fc-muted uppercase tracking-wide">{label}</label>
      {children}
      {hint && <p className="text-xs text-fc-muted">{hint}</p>}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { user, updateMe, logout } = useAuth()
  const nav = useNavigate()
  const [section, setSection] = useState<Section>('account')

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') nav(-1) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [nav])

  if (!user) return null

  return (
    <div className="fixed inset-0 bg-fc-bg z-50 flex">
      {/* Sidebar */}
      <div className="w-64 bg-fc-channel flex flex-col flex-shrink-0 border-r border-fc-hover">
        <div className="p-4 border-b border-fc-hover">
          <h1 className="text-sm font-semibold text-fc-muted uppercase tracking-wide">Paramètres</h1>
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          {NAV.map((item, idx) => (
            <div key={item.id}>
              {item.group && (
                <div className={`px-3 pt-3 pb-1 text-xs font-semibold text-fc-muted uppercase tracking-wide ${idx > 0 ? 'mt-1 border-t border-fc-hover' : ''}`}>
                  {item.group}
                </div>
              )}
              <button
                onClick={() => setSection(item.id)}
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

        <div className="p-3 border-t border-fc-hover text-xs text-fc-muted text-center">
          ForgeChat v3.1.0
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-8 py-8 pb-20">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-xl font-bold text-white">
              {NAV.find(n => n.id === section)?.label}
            </h2>
            <button
              onClick={() => nav(-1)}
              className="p-2 text-fc-muted hover:text-white rounded-lg hover:bg-fc-hover transition"
            >
              <X size={20} />
            </button>
          </div>

          {section === 'account'       && <AccountSection user={user} updateMe={updateMe} />}
          {section === 'profile'       && <ProfileSection user={user} updateMe={updateMe} />}
          {section === 'privacy'       && <PrivacySection />}
          {section === 'appearance'    && <AppearanceSection />}
          {section === 'text_display'  && <TextDisplaySection />}
          {section === 'notifications' && <NotificationsSection />}
          {section === 'audio'         && <AudioSection />}
          {section === 'language'      && <LanguageSection />}
          {section === 'accessibility' && <AccessibilitySection />}
          {section === 'streamer'      && <StreamerSection />}
          {section === 'connected'     && <ConnectedAccountsSection />}
          {section === 'keybindings'   && <KeybindingsSection />}
          {section === 'advanced'      && <AdvancedSection user={user} />}
        </div>
      </div>
    </div>
  )
}

// ─── ACCOUNT ──────────────────────────────────────────────────────────────────

function AccountSection({ user, updateMe }: { user: any; updateMe: (d: any) => void }) {
  const [username, setUsername] = useState(user.username)
  const [showPwForm, setShowPwForm] = useState(false)
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [showOld, setShowOld] = useState(false)
  const [showNew, setShowNew] = useState(false)

  const saveProfile = useMutation({
    mutationFn: () => api.patch('/users/me', { username }),
    onSuccess: r => { updateMe(r.data); toast.success('Profil mis à jour') },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const changePw = useMutation({
    mutationFn: () => api.post('/auth/change-password', { old_password: oldPw, new_password: newPw }),
    onSuccess: () => {
      toast.success('Mot de passe modifié')
      setShowPwForm(false)
      setOldPw('')
      setNewPw('')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Mot de passe incorrect'),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 p-4 bg-fc-channel rounded-xl border border-fc-hover">
        <div className="w-16 h-16 rounded-full bg-fc-accent flex items-center justify-center text-2xl font-bold text-white overflow-hidden flex-shrink-0">
          {user.avatar
            ? <img src={user.avatar} alt="" className="w-full h-full object-cover" />
            : user.username.charAt(0).toUpperCase()}
        </div>
        <div>
          <div className="font-semibold text-white">{user.username}</div>
          <div className="text-sm text-fc-muted">#{user.discriminator ?? '0000'}</div>
          <div className="text-xs text-fc-muted mt-0.5">{user.email}</div>
        </div>
      </div>

      <Field label="Nom d'utilisateur">
        <input
          value={username}
          onChange={e => setUsername(e.target.value)}
          className="w-full bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white focus:border-fc-accent outline-none"
        />
      </Field>

      <button
        onClick={() => saveProfile.mutate()}
        disabled={saveProfile.isPending || username === user.username}
        className="px-5 py-2 bg-fc-accent hover:bg-fc-accent/80 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition"
      >
        {saveProfile.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
      </button>

      {/* 2FA */}
      <div className="border-t border-fc-hover pt-6">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-sm font-semibold text-white">Authentification à deux facteurs</h3>
            <p className="text-xs text-fc-muted">Protège ton compte avec un code temporaire</p>
          </div>
          <button
            onClick={() => toast('2FA bientôt disponible !', { icon: '🔐' })}
            className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition"
          >
            Activer la 2FA
          </button>
        </div>
        <div className="p-3 bg-fc-channel rounded-lg text-xs text-fc-muted">
          <span className="text-yellow-400">Bientôt disponible</span> — l'authentification TOTP (Google Authenticator, Authy) sera intégrée dans la prochaine mise à jour.
        </div>
      </div>

      {/* Mot de passe */}
      <div className="border-t border-fc-hover pt-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Mot de passe</h3>
            <p className="text-xs text-fc-muted">Modifier votre mot de passe de connexion</p>
          </div>
          <button
            onClick={() => setShowPwForm(!showPwForm)}
            className="px-3 py-1.5 text-xs bg-fc-hover text-white rounded-lg hover:bg-fc-hover/80 transition"
          >
            {showPwForm ? 'Annuler' : 'Modifier'}
          </button>
        </div>

        {showPwForm && (
          <div className="space-y-3">
            {[
              { label: 'Mot de passe actuel', value: oldPw, setValue: setOldPw, show: showOld, toggle: () => setShowOld(!showOld) },
              { label: 'Nouveau mot de passe', value: newPw, setValue: setNewPw, show: showNew, toggle: () => setShowNew(!showNew) },
            ].map(field => (
              <Field key={field.label} label={field.label}>
                <div className="relative">
                  <input
                    type={field.show ? 'text' : 'password'}
                    value={field.value}
                    onChange={e => field.setValue(e.target.value)}
                    className="w-full bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 pr-10 text-sm text-white focus:border-fc-accent outline-none"
                  />
                  <button
                    onClick={field.toggle}
                    className="absolute right-3 top-2.5 text-fc-muted hover:text-white transition"
                  >
                    {field.show ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </Field>
            ))}
            <button
              onClick={() => changePw.mutate()}
              disabled={changePw.isPending || !oldPw || !newPw}
              className="px-5 py-2 bg-fc-accent hover:bg-fc-accent/80 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition"
            >
              {changePw.isPending ? 'Modification...' : 'Changer le mot de passe'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── PROFILE ──────────────────────────────────────────────────────────────────

function ProfileSection({ user, updateMe }: { user: any; updateMe: (d: any) => void }) {
  const [bio, setBio] = useState(user.bio ?? '')
  const [pronouns, setPronouns] = useState(user.pronouns ?? '')
  const [bannerPreview, setBannerPreview] = useState<string | null>(user.banner ?? null)
  const fileRef = React.useRef<HTMLInputElement>(null)
  const bannerRef = React.useRef<HTMLInputElement>(null)

  const saveBio = useMutation({
    mutationFn: () => api.patch('/users/me', { bio, pronouns }),
    onSuccess: r => { updateMe(r.data); toast.success('Profil mis à jour') },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const uploadAvatar = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData()
      fd.append('avatar', file)
      return api.post('/users/me/avatar', fd)
    },
    onSuccess: r => { updateMe(r.data); toast.success('Avatar mis à jour') },
    onError: () => toast.error('Erreur upload avatar'),
  })

  const uploadBanner = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData()
      fd.append('banner', file)
      return api.post('/users/me/banner', fd)
    },
    onSuccess: r => {
      setBannerPreview(r.data.banner)
      updateMe({ ...user, banner: r.data.banner })
      toast.success('Bannière mise à jour')
    },
    onError: () => toast.error('Erreur upload bannière'),
  })

  return (
    <div className="space-y-6">
      {/* Bannière */}
      <div>
        <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">Bannière de profil</label>
        <div
          className="relative h-24 rounded-lg overflow-hidden cursor-pointer group border border-fc-hover hover:border-fc-accent transition"
          onClick={() => bannerRef.current?.click()}
        >
          {bannerPreview
            ? <img src={bannerPreview} alt="" className="w-full h-full object-cover" />
            : (
              <div className="w-full h-full bg-fc-channel flex items-center justify-center">
                <div className="text-center">
                  <Camera size={20} className="text-fc-muted mx-auto mb-1" />
                  <p className="text-xs text-fc-muted">Cliquer pour ajouter une bannière</p>
                </div>
              </div>
            )}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition flex items-center justify-center">
            <Camera size={20} className="text-white opacity-0 group-hover:opacity-100 transition" />
          </div>
          {bannerPreview && (
            <button
              onClick={e => {
                e.stopPropagation()
                setBannerPreview(null)
                updateMe({ ...user, banner: null })
                api.patch('/users/me', { banner: null })
              }}
              className="absolute top-1.5 right-1.5 p-1 bg-black/60 rounded-full text-white opacity-0 group-hover:opacity-100 transition hover:bg-red-600"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
        <input
          ref={bannerRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) uploadBanner.mutate(file)
          }}
        />
        <p className="text-xs text-fc-muted mt-1">PNG, JPG, GIF ou WEBP · max 10 MB</p>
      </div>

      {/* Avatar */}
      <div className="flex items-center gap-4">
        <div className="relative">
          <div className="w-20 h-20 rounded-full bg-fc-accent flex items-center justify-center text-3xl font-bold text-white overflow-hidden">
            {user.avatar
              ? <img src={user.avatar} alt="" className="w-full h-full object-cover" />
              : user.username.charAt(0).toUpperCase()}
          </div>
          <button
            onClick={() => fileRef.current?.click()}
            className="absolute -bottom-1 -right-1 p-1.5 bg-fc-accent rounded-full text-white hover:bg-fc-accent/80 transition"
          >
            <Camera size={12} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) uploadAvatar.mutate(file)
            }}
          />
        </div>
        <div>
          <p className="text-sm font-medium text-white">{user.username}</p>
          <p className="text-xs text-fc-muted">Cliquez sur l'avatar pour le changer</p>
        </div>
      </div>

      <Field label="Bio" hint={`${bio.length}/190 caractères`}>
        <textarea
          value={bio}
          onChange={e => setBio(e.target.value)}
          maxLength={190}
          rows={3}
          placeholder="Décrivez-vous en quelques mots..."
          className="w-full bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white resize-none focus:border-fc-accent outline-none placeholder-fc-muted"
        />
      </Field>

      <Field label="Pronoms" hint="Ex : il/lui, elle/elle, iel/iel">
        <input
          value={pronouns}
          onChange={e => setPronouns(e.target.value)}
          maxLength={40}
          placeholder="il/lui"
          className="w-full bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white focus:border-fc-accent outline-none placeholder-fc-muted"
        />
      </Field>

      <button
        onClick={() => saveBio.mutate()}
        disabled={saveBio.isPending}
        className="px-5 py-2 bg-fc-accent hover:bg-fc-accent/80 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition"
      >
        {saveBio.isPending ? 'Sauvegarde...' : 'Sauvegarder le profil'}
      </button>
    </div>
  )
}
