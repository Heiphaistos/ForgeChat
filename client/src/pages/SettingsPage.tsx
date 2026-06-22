import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  User, Palette, Bell, Mic, Shield, Cpu, LogOut, X,
  Camera, Volume2, Globe, Accessibility, Eye, EyeOff,
  Link, Keyboard, Zap, ChevronRight, Check, KeyRound,
  Trash2, Copy, Monitor, Clock, Film, Moon,
} from 'lucide-react'
import { useAuth } from '../store/auth'
import api from '../api/client'
import toast from 'react-hot-toast'
import AppearanceSection from '../components/settings/AppearanceSection'
import ConnectedAccountsSection from '../components/settings/ConnectedAccountsSection'
import KeybindingsSection from '../components/settings/KeybindingsSection'

type Section =
  | 'account' | 'profile' | 'appearance' | 'text_display'
  | 'notifications' | 'audio' | 'privacy' | 'language'
  | 'accessibility' | 'streamer' | 'connected' | 'keybindings' | 'advanced'

const NAV: { id: Section; label: string; icon: React.ReactNode; group?: string }[] = [
  { id: 'account', label: 'Mon compte', icon: <User size={16} />, group: 'Compte' },
  { id: 'profile', label: 'Profil utilisateur', icon: <Camera size={16} /> },
  { id: 'connected', label: 'Comptes connectés', icon: <Link size={16} /> },
  { id: 'appearance', label: 'Apparence', icon: <Palette size={16} />, group: 'Application' },
  { id: 'text_display', label: 'Texte & Affichage', icon: <Monitor size={16} /> },
  { id: 'notifications', label: 'Notifications', icon: <Bell size={16} /> },
  { id: 'keybindings', label: 'Raccourcis clavier', icon: <Keyboard size={16} /> },
  { id: 'language', label: 'Langue & Région', icon: <Globe size={16} /> },
  { id: 'audio', label: 'Audio & Vidéo', icon: <Mic size={16} />, group: 'Voix & Vidéo' },
  { id: 'privacy', label: 'Vie privée', icon: <Shield size={16} />, group: 'Confidentialité' },
  { id: 'accessibility', label: 'Accessibilité', icon: <Accessibility size={16} /> },
  { id: 'streamer', label: 'Mode Streamer', icon: <Film size={16} /> },
  { id: 'advanced', label: 'Avancé', icon: <Cpu size={16} />, group: 'Avancé' },
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

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${value ? 'bg-fc-accent' : 'bg-fc-hover'}`}
    >
      <span className={`inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
    </button>
  )
}

function Select({ value, onChange, options, className = '' }: {
  value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]; className?: string
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white focus:border-fc-accent outline-none ${className}`}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
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

  const groups: string[] = []
  NAV.forEach(item => { if (item.group && !groups.includes(item.group)) groups.push(item.group) })

  return (
    <div className="fixed inset-0 bg-fc-bg z-50 flex">
      {/* Sidebar */}
      <div className="w-64 bg-fc-channel flex flex-col flex-shrink-0 border-r border-fc-hover">
        <div className="p-4 border-b border-fc-hover">
          <h1 className="text-sm font-semibold text-fc-muted uppercase tracking-wide">Paramètres</h1>
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          {groups.map((group, gi) => {
            const items = NAV.filter(item => {
              const idx = NAV.indexOf(item)
              const prevGroup = NAV.slice(0, idx).reverse().find(i => i.group)?.group
              if (item.group === group) return true
              if (!item.group && prevGroup === group) {
                const nextGroupItem = NAV.slice(idx).find(i => i.group)
                return nextGroupItem?.group !== group
              }
              return false
            })
            const groupItems = NAV.filter((item, idx) => {
              if (item.group === group) return true
              const before = NAV.slice(0, idx).reverse()
              const ownerGroup = before.find(i => i.group)?.group
              if (ownerGroup !== group) return false
              const afterGroups = NAV.slice(idx + 1).find(i => i.group)
              return true
            })

            // Simpler: just find consecutive items after each group header
            return null
          })}

          {/* Render flat with visual separators */}
          {NAV.map((item, idx) => {
            const showSep = idx > 0 && item.group && NAV[idx - 1].group !== item.group
            return (
              <div key={item.id}>
                {(idx === 0 || item.group) && (
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
            )
          })}

          <div className="border-t border-fc-hover my-2" />
          <button
            onClick={async () => { await logout(); nav('/login') }}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-fc-red hover:bg-fc-red/10 transition"
          >
            <LogOut size={16} /> Déconnexion
          </button>
        </nav>

        <div className="p-3 border-t border-fc-hover text-xs text-fc-muted text-center">ForgeChat v3.1.0</div>
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

          {section === 'account' && <AccountSection user={user} updateMe={updateMe} />}
          {section === 'profile' && <ProfileSection user={user} updateMe={updateMe} />}
          {section === 'appearance' && <AppearanceSection />}
          {section === 'text_display' && <TextDisplaySection />}
          {section === 'notifications' && <NotificationsSection />}
          {section === 'audio' && <AudioSection />}
          {section === 'privacy' && <PrivacySection />}
          {section === 'language' && <LanguageSection />}
          {section === 'accessibility' && <AccessibilitySection />}
          {section === 'streamer' && <StreamerSection />}
          {section === 'connected' && <ConnectedAccountsSection />}
          {section === 'keybindings' && <KeybindingsSection />}
          {section === 'advanced' && <AdvancedSection user={user} />}
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
    onSuccess: () => { toast.success('Mot de passe modifié'); setShowPwForm(false); setOldPw(''); setNewPw('') },
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
            : <div className="w-full h-full bg-fc-channel flex items-center justify-center">
                <div className="text-center">
                  <Camera size={20} className="text-fc-muted mx-auto mb-1" />
                  <p className="text-xs text-fc-muted">Cliquer pour ajouter une bannière</p>
                </div>
              </div>}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition flex items-center justify-center">
            <Camera size={20} className="text-white opacity-0 group-hover:opacity-100 transition" />
          </div>
          {bannerPreview && (
            <button
              onClick={e => { e.stopPropagation(); setBannerPreview(null); updateMe({ ...user, banner: null }); api.patch('/users/me', { banner: null }) }}
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
          maxLength={30}
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

// ─── TEXT & DISPLAY ───────────────────────────────────────────────────────────

function TextDisplaySection() {
  const { data: settings, refetch } = useQuery({
    queryKey: ['user-settings'],
    queryFn: () => api.get('/user/settings').then(r => r.data),
    staleTime: 60_000,
  })

  const save = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.put('/user/settings', data),
    onSuccess: () => { toast.success('Sauvegardé'); refetch() },
  })

  const [emojiStyle, setEmojiStyle] = useState('native')
  const [timeFormat, setTimeFormat] = useState('24h')
  const [dateFormat, setDateFormat] = useState('DD/MM/YYYY')
  const [timestamps, setTimestamps] = useState('hover')
  const [gifAutoplay, setGifAutoplay] = useState('always')
  const [linkPreview, setLinkPreview] = useState(true)
  const [messageGrouping, setMessageGrouping] = useState(5)

  useEffect(() => {
    if (settings) {
      setEmojiStyle(settings.emoji_style ?? 'native')
      setTimeFormat(settings.time_format ?? '24h')
      setDateFormat(settings.date_format ?? 'DD/MM/YYYY')
      setTimestamps(settings.show_timestamps ?? 'hover')
      setGifAutoplay(settings.gif_autoplay ?? 'always')
      setLinkPreview(settings.link_preview ?? true)
      setMessageGrouping(settings.message_grouping_minutes ?? 5)
    }
  }, [settings])

  return (
    <div className="space-y-6">
      <Field label="Style d'emojis">
        <Select value={emojiStyle} onChange={setEmojiStyle} className="w-full"
          options={[{ value: 'native', label: 'Emojis natifs du système' }, { value: 'twemoji', label: 'Twemoji (Twitter)' }]} />
      </Field>

      <Field label="Format de l'heure">
        <Select value={timeFormat} onChange={setTimeFormat} className="w-full"
          options={[{ value: '24h', label: '24 heures (14:30)' }, { value: '12h', label: '12 heures (2:30 PM)' }]} />
      </Field>

      <Field label="Format de date">
        <Select value={dateFormat} onChange={setDateFormat} className="w-full"
          options={[
            { value: 'DD/MM/YYYY', label: 'JJ/MM/AAAA (31/12/2025)' },
            { value: 'MM/DD/YYYY', label: 'MM/JJ/AAAA (12/31/2025)' },
            { value: 'YYYY-MM-DD', label: 'ISO (2025-12-31)' },
          ]} />
      </Field>

      <Field label="Affichage des horodatages">
        <Select value={timestamps} onChange={setTimestamps} className="w-full"
          options={[
            { value: 'always', label: 'Toujours visible' },
            { value: 'hover', label: 'Au survol' },
            { value: 'never', label: 'Jamais' },
          ]} />
      </Field>

      <Field label="Lecture automatique des GIFs">
        <Select value={gifAutoplay} onChange={setGifAutoplay} className="w-full"
          options={[
            { value: 'always', label: 'Toujours' },
            { value: 'hover', label: 'Au survol' },
            { value: 'never', label: 'Jamais' },
          ]} />
      </Field>

      <Field label={`Délai de regroupement des messages — ${messageGrouping} min`}>
        <input type="range" min={1} max={30} value={messageGrouping}
          onChange={e => setMessageGrouping(Number(e.target.value))}
          className="w-full accent-fc-accent" />
      </Field>

      <div className="flex items-center justify-between p-4 bg-fc-channel rounded-xl border border-fc-hover">
        <div>
          <div className="text-sm font-medium text-white">Prévisualisations de liens</div>
          <div className="text-xs text-fc-muted">Affiche un aperçu des URLs partagées</div>
        </div>
        <Toggle value={linkPreview} onChange={setLinkPreview} />
      </div>

      <button
        onClick={() => save.mutate({ emoji_style: emojiStyle, time_format: timeFormat, date_format: dateFormat, show_timestamps: timestamps, gif_autoplay: gifAutoplay, link_preview: linkPreview, message_grouping_minutes: messageGrouping })}
        disabled={save.isPending}
        className="w-full py-2.5 bg-fc-accent hover:bg-fc-accent/80 text-white rounded-lg font-medium text-sm transition disabled:opacity-50"
      >
        {save.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
      </button>
    </div>
  )
}

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────

function NotificationsSection() {
  const { data: settings, refetch } = useQuery({
    queryKey: ['user-settings'],
    queryFn: () => api.get('/user/settings').then(r => r.data),
    staleTime: 60_000,
  })

  const save = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.put('/user/settings', data),
    onSuccess: () => { toast.success('Sauvegardé'); refetch() },
  })

  const [quietEnabled, setQuietEnabled] = useState(false)
  const [quietStart, setQuietStart] = useState('22:00')
  const [quietEnd, setQuietEnd] = useState('08:00')

  useEffect(() => {
    if (settings) {
      setQuietEnabled(settings.quiet_hours_enabled ?? false)
      setQuietStart(settings.quiet_hours_start ?? '22:00')
      setQuietEnd(settings.quiet_hours_end ?? '08:00')
    }
  }, [settings])

  return (
    <div className="space-y-6">
      <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-white flex items-center gap-2"><Moon size={14} /> Heures silencieuses</div>
            <div className="text-xs text-fc-muted">Aucune notification pendant cette plage</div>
          </div>
          <Toggle value={quietEnabled} onChange={setQuietEnabled} />
        </div>

        {quietEnabled && (
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-fc-hover">
            <div>
              <label className="text-xs text-fc-muted mb-1 block">Début</label>
              <input type="time" value={quietStart} onChange={e => setQuietStart(e.target.value)}
                className="w-full bg-fc-bg border border-fc-hover rounded-lg px-3 py-2 text-sm text-white" />
            </div>
            <div>
              <label className="text-xs text-fc-muted mb-1 block">Fin</label>
              <input type="time" value={quietEnd} onChange={e => setQuietEnd(e.target.value)}
                className="w-full bg-fc-bg border border-fc-hover rounded-lg px-3 py-2 text-sm text-white" />
            </div>
          </div>
        )}
      </div>

      <button
        onClick={() => save.mutate({ quiet_hours_enabled: quietEnabled, quiet_hours_start: quietStart, quiet_hours_end: quietEnd })}
        disabled={save.isPending}
        className="w-full py-2.5 bg-fc-accent hover:bg-fc-accent/80 text-white rounded-lg font-medium text-sm transition disabled:opacity-50"
      >
        {save.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
      </button>
    </div>
  )
}

// ─── AUDIO ────────────────────────────────────────────────────────────────────

function AudioSection() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedInput, setSelectedInput] = useState('')
  const [selectedOutput, setSelectedOutput] = useState('')

  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then(list => {
      setDevices(list)
      const saved_in = localStorage.getItem('fc_audio_input') ?? ''
      const saved_out = localStorage.getItem('fc_audio_output') ?? ''
      setSelectedInput(saved_in)
      setSelectedOutput(saved_out)
    })
  }, [])

  const inputDevices = devices.filter(d => d.kind === 'audioinput')
  const outputDevices = devices.filter(d => d.kind === 'audiooutput')

  const handleInputChange = (id: string) => {
    setSelectedInput(id)
    localStorage.setItem('fc_audio_input', id)
  }

  const handleOutputChange = (id: string) => {
    setSelectedOutput(id)
    localStorage.setItem('fc_audio_output', id)
  }

  return (
    <div className="space-y-6">
      <Field label="Périphérique d'entrée (Microphone)">
        <select
          value={selectedInput}
          onChange={e => handleInputChange(e.target.value)}
          className="w-full bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white"
        >
          <option value="">Défaut du système</option>
          {inputDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Micro ${d.deviceId.slice(0, 6)}`}</option>)}
        </select>
      </Field>

      <Field label="Périphérique de sortie (Haut-parleurs)">
        <select
          value={selectedOutput}
          onChange={e => handleOutputChange(e.target.value)}
          className="w-full bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white"
        >
          <option value="">Défaut du système</option>
          {outputDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Sortie ${d.deviceId.slice(0, 6)}`}</option>)}
        </select>
      </Field>

      <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover space-y-1 text-sm text-fc-muted">
        <p className="text-white font-medium text-xs uppercase tracking-wide mb-2">Test micro</p>
        <p>Rejoignez un canal vocal pour tester votre microphone en temps réel.</p>
        {devices.length === 0 && <p className="text-xs text-fc-yellow">Autorisez l'accès au micro pour voir vos périphériques.</p>}
      </div>
    </div>
  )
}

// ─── PRIVACY ──────────────────────────────────────────────────────────────────

function PrivacySection() {
  const { data: settings, refetch } = useQuery({
    queryKey: ['user-settings'],
    queryFn: () => api.get('/user/settings').then(r => r.data),
    staleTime: 60_000,
  })

  const save = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.put('/user/settings', data),
    onSuccess: () => { toast.success('Sauvegardé'); refetch() },
  })

  const [showOnline, setShowOnline] = useState(true)
  const [activityVisibility, setActivityVisibility] = useState('everyone')
  const [friendRequestFrom, setFriendRequestFrom] = useState('everyone')
  const [dmFromAll, setDmFromAll] = useState(true)
  const [explicitFilter, setExplicitFilter] = useState('none')

  useEffect(() => {
    if (settings) {
      setShowOnline(settings.show_online ?? true)
      setActivityVisibility(settings.activity_visibility ?? 'everyone')
      setFriendRequestFrom(settings.friend_request_from ?? 'everyone')
      setDmFromAll(settings.dm_from_all ?? true)
      setExplicitFilter(settings.explicit_content_filter ?? 'none')
    }
  }, [settings])

  return (
    <div className="space-y-4">
      {[
        { label: 'Afficher mon statut en ligne', desc: 'Les autres peuvent voir si vous êtes connecté', value: showOnline, onChange: setShowOnline },
        { label: 'Autoriser les DMs de tout le monde', desc: 'Messages directs de personnes non-amies', value: dmFromAll, onChange: setDmFromAll },
      ].map(item => (
        <div key={item.label} className="flex items-center justify-between p-4 bg-fc-channel rounded-xl border border-fc-hover">
          <div>
            <div className="text-sm font-medium text-white">{item.label}</div>
            <div className="text-xs text-fc-muted">{item.desc}</div>
          </div>
          <Toggle value={item.value} onChange={item.onChange} />
        </div>
      ))}

      <Field label="Qui peut voir votre activité">
        <Select value={activityVisibility} onChange={setActivityVisibility} className="w-full"
          options={[{ value: 'everyone', label: 'Tout le monde' }, { value: 'friends', label: 'Amis uniquement' }, { value: 'nobody', label: 'Personne' }]} />
      </Field>

      <Field label="Qui peut vous envoyer des demandes d'amis">
        <Select value={friendRequestFrom} onChange={setFriendRequestFrom} className="w-full"
          options={[{ value: 'everyone', label: 'Tout le monde' }, { value: 'friends_of_friends', label: 'Amis d\'amis' }, { value: 'nobody', label: 'Personne' }]} />
      </Field>

      <Field label="Filtre de contenu explicite">
        <Select value={explicitFilter} onChange={setExplicitFilter} className="w-full"
          options={[
            { value: 'none', label: 'Désactivé' },
            { value: 'members_without_roles', label: 'Membres sans rôles' },
            { value: 'all', label: 'Tous les messages' },
          ]} />
      </Field>

      <button
        onClick={() => save.mutate({ show_online: showOnline, activity_visibility: activityVisibility, friend_request_from: friendRequestFrom, dm_from_all: dmFromAll, explicit_content_filter: explicitFilter })}
        disabled={save.isPending}
        className="w-full py-2.5 bg-fc-accent hover:bg-fc-accent/80 text-white rounded-lg font-medium text-sm transition disabled:opacity-50"
      >
        {save.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
      </button>
    </div>
  )
}

// ─── LANGUAGE ─────────────────────────────────────────────────────────────────

function LanguageSection() {
  const { data: settings, refetch } = useQuery({
    queryKey: ['user-settings'],
    queryFn: () => api.get('/user/settings').then(r => r.data),
    staleTime: 60_000,
  })
  const save = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.put('/user/settings', data),
    onSuccess: () => { toast.success('Sauvegardé'); refetch() },
  })
  const [language, setLanguage] = useState('fr')

  useEffect(() => { if (settings) setLanguage(settings.language ?? 'fr') }, [settings])

  const LANGS = [
    { value: 'fr', label: '🇫🇷 Français' }, { value: 'en', label: '🇬🇧 English' },
    { value: 'es', label: '🇪🇸 Español' }, { value: 'de', label: '🇩🇪 Deutsch' },
    { value: 'pt', label: '🇧🇷 Português' }, { value: 'ja', label: '🇯🇵 日本語' },
    { value: 'ko', label: '🇰🇷 한국어' }, { value: 'zh', label: '🇨🇳 中文' },
  ]

  return (
    <div className="space-y-4">
      <Field label="Langue de l'interface">
        <Select value={language} onChange={setLanguage} className="w-full" options={LANGS} />
      </Field>
      <button
        onClick={() => save.mutate({ language })}
        disabled={save.isPending}
        className="w-full py-2.5 bg-fc-accent hover:bg-fc-accent/80 text-white rounded-lg font-medium text-sm transition disabled:opacity-50"
      >
        {save.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
      </button>
    </div>
  )
}

// ─── ACCESSIBILITY ────────────────────────────────────────────────────────────

function AccessibilitySection() {
  const { data: settings, refetch } = useQuery({
    queryKey: ['user-settings'],
    queryFn: () => api.get('/user/settings').then(r => r.data),
    staleTime: 60_000,
  })
  const save = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.put('/user/settings', data),
    onSuccess: () => { toast.success('Sauvegardé'); refetch() },
  })
  const [reduceMotion, setReduceMotion] = useState(false)
  const [highContrast, setHighContrast] = useState(false)
  const [colorblindMode, setColorblindMode] = useState('none')
  const [zoom, setZoom] = useState(() => Number(localStorage.getItem('fc_zoom') ?? '100'))

  useEffect(() => {
    if (settings) {
      setReduceMotion(settings.reduce_motion ?? false)
      setHighContrast(settings.high_contrast ?? false)
      setColorblindMode(settings.colorblind_mode ?? 'none')
    }
  }, [settings])

  const applyZoom = (val: number) => {
    setZoom(val)
    localStorage.setItem('fc_zoom', String(val))
    document.documentElement.style.fontSize = `${val}%`
  }

  const applyReduceMotion = (val: boolean) => {
    setReduceMotion(val)
    document.documentElement.setAttribute('data-reduce-motion', String(val))
  }

  const applyHighContrast = (val: boolean) => {
    setHighContrast(val)
    document.documentElement.classList.toggle('high-contrast', val)
  }

  return (
    <div className="space-y-4">
      {/* Zoom de l'interface */}
      <Field label={`Zoom de l'interface — ${zoom}%`} hint="Ajuste la taille générale de l'interface (80% à 130%)">
        <input
          type="range" min={80} max={130} step={5} value={zoom}
          onChange={e => applyZoom(Number(e.target.value))}
          className="w-full accent-fc-accent"
        />
        <div className="flex justify-between text-xs text-fc-muted mt-1">
          <span>80%</span><span>100%</span><span>130%</span>
        </div>
      </Field>

      {[
        { label: 'Réduire les animations', desc: 'Moins d\'effets visuels et de transitions', value: reduceMotion, onChange: applyReduceMotion },
        { label: 'Contraste élevé', desc: 'Améliore la lisibilité des textes', value: highContrast, onChange: applyHighContrast },
      ].map(item => (
        <div key={item.label} className="flex items-center justify-between p-4 bg-fc-channel rounded-xl border border-fc-hover">
          <div>
            <div className="text-sm font-medium text-white">{item.label}</div>
            <div className="text-xs text-fc-muted">{item.desc}</div>
          </div>
          <Toggle value={item.value} onChange={item.onChange} />
        </div>
      ))}

      <Field label="Mode daltonisme">
        <Select value={colorblindMode} onChange={setColorblindMode} className="w-full"
          options={[
            { value: 'none', label: 'Aucun' },
            { value: 'deuteranopia', label: 'Deutéranopie (rouge-vert)' },
            { value: 'protanopia', label: 'Protanopie (rouge)' },
            { value: 'tritanopia', label: 'Tritanopie (bleu-jaune)' },
          ]} />
      </Field>

      <button
        onClick={() => save.mutate({ reduce_motion: reduceMotion, high_contrast: highContrast, colorblind_mode: colorblindMode })}
        disabled={save.isPending}
        className="w-full py-2.5 bg-fc-accent hover:bg-fc-accent/80 text-white rounded-lg font-medium text-sm transition disabled:opacity-50"
      >
        {save.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
      </button>
    </div>
  )
}

// ─── STREAMER MODE ────────────────────────────────────────────────────────────

function StreamerSection() {
  const { data: settings, refetch } = useQuery({
    queryKey: ['user-settings'],
    queryFn: () => api.get('/user/settings').then(r => r.data),
    staleTime: 60_000,
  })
  const save = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.put('/user/settings', data),
    onSuccess: () => { toast.success('Sauvegardé'); refetch() },
  })
  const [streamerMode, setStreamerMode] = useState(false)

  useEffect(() => { if (settings) setStreamerMode(settings.streamer_mode ?? false) }, [settings])

  const HIDDEN_ITEMS = [
    'Adresse e-mail', 'Tag utilisateur', 'Invitations de serveur',
    'URLs de streaming', 'Informations personnelles du profil',
    'Notifications d\'appel entrant',
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between p-4 bg-fc-channel rounded-xl border border-fc-hover">
        <div>
          <div className="text-sm font-medium text-white flex items-center gap-2"><Film size={14} /> Mode Streamer</div>
          <div className="text-xs text-fc-muted">Masque les informations sensibles à l'écran</div>
        </div>
        <Toggle value={streamerMode} onChange={setStreamerMode} />
      </div>

      {streamerMode && (
        <div className="space-y-2">
          <p className="text-xs text-fc-muted uppercase tracking-wide font-semibold">Éléments masqués</p>
          {HIDDEN_ITEMS.map(item => (
            <div key={item} className="flex items-center gap-2 text-sm text-fc-muted">
              <Check size={12} className="text-fc-green" /> {item}
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => save.mutate({ streamer_mode: streamerMode })}
        disabled={save.isPending}
        className="w-full py-2.5 bg-fc-accent hover:bg-fc-accent/80 text-white rounded-lg font-medium text-sm transition disabled:opacity-50"
      >
        {save.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
      </button>
    </div>
  )
}

// ─── ADVANCED ─────────────────────────────────────────────────────────────────

function AdvancedSection({ user }: { user: any }) {
  const nav = useNavigate()
  const { logout } = useAuth()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteInput, setDeleteInput] = useState('')

  const deleteAccount = useMutation({
    mutationFn: () => api.delete('/users/me'),
    onSuccess: async () => { await logout(); nav('/login') },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur suppression'),
  })

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-white mb-2">Cache local</h3>
        <button
          onClick={() => { localStorage.clear(); toast.success('Cache vidé — rechargement...'); setTimeout(() => location.reload(), 800) }}
          className="px-4 py-2 bg-fc-hover text-white rounded-lg text-sm hover:bg-fc-hover/80 transition"
        >
          Vider le cache
        </button>
      </div>

      <div className="border-t border-fc-hover pt-6">
        <h3 className="text-sm font-semibold text-white mb-1">Informations de débogage</h3>
        <div className="bg-fc-channel rounded-lg p-3 text-xs font-mono text-fc-muted space-y-1">
          <div>UserID: {user.id}</div>
          <div>Version: 3.1.0</div>
          <div>UA: {navigator.userAgent.slice(0, 60)}...</div>
        </div>
        <button
          onClick={() => { navigator.clipboard.writeText(user.id); toast.success('ID copié') }}
          className="mt-2 flex items-center gap-1.5 text-xs text-fc-muted hover:text-white transition"
        >
          <Copy size={12} /> Copier l'ID utilisateur
        </button>
      </div>

      <div className="border-t border-fc-hover pt-6">
        <h3 className="text-sm font-semibold text-fc-red mb-1">Zone dangereuse</h3>
        <p className="text-xs text-fc-muted mb-3">La suppression du compte est irréversible.</p>

        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="flex items-center gap-2 px-4 py-2 bg-fc-red/10 text-fc-red rounded-lg text-sm hover:bg-fc-red/20 transition"
          >
            <Trash2 size={14} /> Supprimer mon compte
          </button>
        ) : (
          <div className="space-y-3 p-4 border border-fc-red/40 rounded-xl">
            <p className="text-sm text-white">Tapez <strong>{user.username}</strong> pour confirmer</p>
            <input
              value={deleteInput}
              onChange={e => setDeleteInput(e.target.value)}
              className="w-full bg-fc-channel border border-fc-red/40 rounded-lg px-3 py-2 text-sm text-white focus:border-fc-red outline-none"
            />
            <div className="flex gap-2">
              <button onClick={() => { setConfirmDelete(false); setDeleteInput('') }}
                className="flex-1 py-2 border border-fc-hover text-fc-muted rounded-lg text-sm hover:text-white transition">
                Annuler
              </button>
              <button
                onClick={() => deleteAccount.mutate()}
                disabled={deleteInput !== user.username || deleteAccount.isPending}
                className="flex-1 py-2 bg-fc-red text-white rounded-lg text-sm disabled:opacity-50 transition hover:bg-fc-red/80"
              >
                {deleteAccount.isPending ? 'Suppression...' : 'Supprimer définitivement'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Fix React import for fileRef
import React from 'react'
