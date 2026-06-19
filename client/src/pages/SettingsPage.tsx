import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import {
  User, Palette, Bell, Mic, Shield, Cpu, LogOut, X,
  Camera, ChevronRight, Check, Volume2, Monitor, Smartphone,
  Trash2, Copy, Eye, EyeOff, KeyRound,
} from 'lucide-react'
import { useAuth } from '../store/auth'
import api, { SERVER_URL } from '../api/client'
import toast from 'react-hot-toast'

type Section =
  | 'account' | 'profile' | 'appearance' | 'notifications'
  | 'audio' | 'privacy' | 'advanced'

const NAV: { id: Section; label: string; icon: React.ReactNode; danger?: boolean }[] = [
  { id: 'account', label: 'Mon compte', icon: <User size={16} /> },
  { id: 'profile', label: 'Profil utilisateur', icon: <Camera size={16} /> },
  { id: 'appearance', label: 'Apparence', icon: <Palette size={16} /> },
  { id: 'notifications', label: 'Notifications', icon: <Bell size={16} /> },
  { id: 'audio', label: 'Audio & Vidéo', icon: <Mic size={16} /> },
  { id: 'privacy', label: 'Vie privée', icon: <Shield size={16} /> },
  { id: 'advanced', label: 'Avancé', icon: <Cpu size={16} /> },
]

const THEMES = [
  { id: 'dark', label: 'Sombre', accent: '#5865f2', bg: '#1a1b1e', preview: ['#1a1b1e', '#232428', '#36393f'] },
  { id: 'darker', label: 'AMOLED', accent: '#5865f2', bg: '#000', preview: ['#000', '#0a0a0a', '#0d0d0d'] },
  { id: 'light', label: 'Clair', accent: '#5865f2', bg: '#f2f3f5', preview: ['#f2f3f5', '#ebedef', '#fff'] },
  { id: 'dracula', label: 'Dracula', accent: '#bd93f9', bg: '#282a36', preview: ['#282a36', '#1e1f2b', '#353746'] },
  { id: 'nord', label: 'Nord', accent: '#5e81ac', bg: '#2e3440', preview: ['#2e3440', '#3b4252', '#434c5e'] },
  { id: 'catppuccin', label: 'Catppuccin', accent: '#cba6f7', bg: '#1e1e2e', preview: ['#1e1e2e', '#181825', '#313244'] },
  { id: 'gruvbox', label: 'Gruvbox', accent: '#d65d0e', bg: '#1d2021', preview: ['#1d2021', '#282828', '#3c3836'] },
  { id: 'tokyonight', label: 'Tokyo Night', accent: '#7aa2f7', bg: '#1a1b2e', preview: ['#1a1b2e', '#1f2040', '#24283b'] },
  { id: 'onedark', label: 'One Dark', accent: '#61afef', bg: '#282c34', preview: ['#282c34', '#2c313c', '#3b4048'] },
  { id: 'cyberpunk', label: 'Cyberpunk', accent: '#f0e14a', bg: '#0d0d0d', preview: ['#0d0d0d', '#111111', '#161616'] },
  { id: 'monokai', label: 'Monokai', accent: '#a6e22e', bg: '#272822', preview: ['#272822', '#2d2e2a', '#383830'] },
  { id: 'solarized', label: 'Solarized', accent: '#268bd2', bg: '#002b36', preview: ['#002b36', '#073642', '#0d4a5c'] },
  { id: 'forest', label: 'Forêt', accent: '#6cb340', bg: '#1a2318', preview: ['#1a2318', '#1e2a1c', '#243222'] },
  { id: 'ocean', label: 'Océan', accent: '#00d4ff', bg: '#0f2340', preview: ['#0f2340', '#0d2238', '#112a47'] },
  { id: 'neon', label: 'Neon', accent: '#00ff88', bg: '#0a0a14', preview: ['#0a0a14', '#0d0d1a', '#111120'] },
  { id: 'matrix', label: 'Matrix', accent: '#00ff00', bg: '#000000', preview: ['#000000', '#040804', '#060c06'] },
]

const FONT_SIZES = [
  { id: 'sm', label: 'Petit', px: '13px' },
  { id: 'md', label: 'Normal', px: '14px' },
  { id: 'lg', label: 'Grand', px: '16px' },
  { id: 'xl', label: 'Très grand', px: '18px' },
]

const STATUSES = [
  { value: 'online', label: 'En ligne', color: 'bg-fc-green' },
  { value: 'idle', label: 'Absent', color: 'bg-fc-yellow' },
  { value: 'dnd', label: 'Ne pas déranger', color: 'bg-fc-red' },
  { value: 'invisible', label: 'Invisible', color: 'bg-fc-muted' },
]

export default function SettingsPage() {
  const { user, updateMe, logout } = useAuth()
  const nav = useNavigate()
  const [section, setSection] = useState<Section>('account')

  const close = () => nav(-1)

  if (!user) return null

  return (
    <div className="fixed inset-0 bg-fc-bg z-50 flex">
      {/* Sidebar nav */}
      <div className="w-64 bg-fc-channel flex flex-col flex-shrink-0 border-r border-fc-hover">
        <div className="p-4 border-b border-fc-hover">
          <h1 className="text-sm font-semibold text-fc-muted uppercase tracking-wide">Paramètres</h1>
        </div>

        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {NAV.map(item => (
            <button
              key={item.id}
              onClick={() => setSection(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition
                ${section === item.id
                  ? 'bg-fc-hover text-white'
                  : item.danger
                  ? 'text-fc-red hover:bg-fc-red/10'
                  : 'text-fc-muted hover:bg-fc-hover hover:text-white'}`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}

          <div className="border-t border-fc-hover my-2" />

          <button
            onClick={async () => { await logout(); nav('/login') }}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-fc-red hover:bg-fc-red/10 transition"
          >
            <LogOut size={16} />
            Déconnexion
          </button>
        </nav>

        <div className="p-3 border-t border-fc-hover text-xs text-fc-muted text-center">
          ForgeChat v1.3.0
        </div>
      </div>

      {/* Contenu */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-8 py-8 pb-20">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-xl font-bold text-white">
              {NAV.find(n => n.id === section)?.label}
            </h2>
            <button
              onClick={close}
              className="p-2 text-fc-muted hover:text-white rounded-lg hover:bg-fc-hover transition"
              title="Fermer (Échap)"
            >
              <X size={20} />
            </button>
          </div>

          {section === 'account' && <AccountSection user={user} updateMe={updateMe} />}
          {section === 'profile' && <ProfileSection user={user} updateMe={updateMe} />}
          {section === 'appearance' && <AppearanceSection />}
          {section === 'notifications' && <NotificationsSection />}
          {section === 'audio' && <AudioSection />}
          {section === 'privacy' && <PrivacySection />}
          {section === 'advanced' && <AdvancedSection user={user} />}
        </div>
      </div>
    </div>
  )
}

// ─── COMPTE ──────────────────────────────────────────────────────────────────

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
      {/* Avatar preview */}
      <div className="flex items-center gap-4 p-4 bg-fc-channel rounded-xl border border-fc-hover">
        <div className="w-16 h-16 rounded-full bg-fc-accent flex items-center justify-center text-2xl font-bold text-white overflow-hidden flex-shrink-0">
          {user.avatar
            ? <img src={user.avatar} alt="" className="w-full h-full object-cover" />
            : user.username.charAt(0).toUpperCase()}
        </div>
        <div>
          <div className="font-semibold text-white">{user.username}</div>
          <div className="text-sm text-fc-muted">#{user.discriminator}</div>
          <div className="text-xs text-fc-muted mt-0.5">{user.email}</div>
        </div>
      </div>

      <Field label="Nom d'utilisateur">
        <input
          value={username}
          onChange={e => setUsername(e.target.value)}
          maxLength={32}
          className="fc-input"
        />
      </Field>

      <Field label="Email">
        <input value={user.email ?? ''} disabled className="fc-input opacity-50 cursor-not-allowed" />
      </Field>

      <button
        onClick={() => saveProfile.mutate()}
        disabled={saveProfile.isPending || username === user.username}
        className="btn-primary"
      >
        {saveProfile.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
      </button>

      <div className="border-t border-fc-hover pt-6">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <KeyRound size={14} className="text-fc-muted" /> Mot de passe
        </h3>
        {!showPwForm ? (
          <button onClick={() => setShowPwForm(true)} className="btn-secondary">
            Changer le mot de passe
          </button>
        ) : (
          <div className="space-y-3">
            <Field label="Mot de passe actuel">
              <div className="relative">
                <input
                  type={showOld ? 'text' : 'password'}
                  value={oldPw}
                  onChange={e => setOldPw(e.target.value)}
                  className="fc-input pr-10"
                />
                <button
                  onClick={() => setShowOld(!showOld)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-fc-muted hover:text-white"
                >
                  {showOld ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </Field>
            <Field label="Nouveau mot de passe">
              <div className="relative">
                <input
                  type={showNew ? 'text' : 'password'}
                  value={newPw}
                  onChange={e => setNewPw(e.target.value)}
                  minLength={8}
                  className="fc-input pr-10"
                />
                <button
                  onClick={() => setShowNew(!showNew)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-fc-muted hover:text-white"
                >
                  {showNew ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </Field>
            <div className="flex gap-2">
              <button
                onClick={() => changePw.mutate()}
                disabled={changePw.isPending || !oldPw || newPw.length < 8}
                className="btn-primary"
              >
                {changePw.isPending ? 'Modification...' : 'Confirmer'}
              </button>
              <button onClick={() => setShowPwForm(false)} className="btn-secondary">
                Annuler
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── PROFIL ───────────────────────────────────────────────────────────────────

function ProfileSection({ user, updateMe }: { user: any; updateMe: (d: any) => void }) {
  const [bio, setBio] = useState(user.bio ?? '')
  const [customStatus, setCustomStatus] = useState(user.custom_status ?? '')
  const [status, setStatus] = useState(user.status ?? 'online')
  const avatarRef = useRef<HTMLInputElement>(null)

  const save = useMutation({
    mutationFn: () => api.patch('/users/me', { bio, custom_status: customStatus, status }),
    onSuccess: r => { updateMe(r.data); toast.success('Profil mis à jour') },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const uploadAvatar = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData()
      fd.append('avatar', file)
      return api.post('/users/me/avatar', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    },
    onSuccess: r => { updateMe(r.data); toast.success('Avatar mis à jour') },
    onError: () => toast.error("Impossible d'uploader l'avatar"),
  })

  return (
    <div className="space-y-6">
      {/* Avatar upload */}
      <div className="flex items-center gap-5">
        <div className="relative group cursor-pointer" onClick={() => avatarRef.current?.click()}>
          <div className="w-20 h-20 rounded-full bg-fc-accent flex items-center justify-center text-3xl font-bold text-white overflow-hidden">
            {user.avatar
              ? <img src={user.avatar} alt="" className="w-full h-full object-cover" />
              : user.username.charAt(0).toUpperCase()}
          </div>
          <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
            <Camera size={20} className="text-white" />
          </div>
        </div>
        <div>
          <button onClick={() => avatarRef.current?.click()} className="btn-secondary text-sm">
            Modifier l'avatar
          </button>
          <p className="text-xs text-fc-muted mt-1">JPG, PNG, GIF · Max 8 MB</p>
        </div>
        <input
          ref={avatarRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) uploadAvatar.mutate(file)
          }}
        />
      </div>

      <Field label="À propos de moi" hint={`${bio.length}/190`}>
        <textarea
          value={bio}
          onChange={e => setBio(e.target.value)}
          maxLength={190}
          rows={3}
          placeholder="Parle un peu de toi..."
          className="fc-input resize-none"
        />
      </Field>

      <Field label="Statut personnalisé">
        <input
          value={customStatus}
          onChange={e => setCustomStatus(e.target.value)}
          maxLength={128}
          placeholder="Ce que tu fais en ce moment..."
          className="fc-input"
        />
      </Field>

      <div>
        <label className="fc-label">Statut de présence</label>
        <div className="grid grid-cols-2 gap-2 mt-2">
          {STATUSES.map(s => (
            <button
              key={s.value}
              onClick={() => setStatus(s.value)}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border transition text-sm
                ${status === s.value
                  ? 'border-fc-accent bg-fc-accent/10 text-white'
                  : 'border-fc-hover text-fc-muted hover:text-white hover:border-fc-hover/80'}`}
            >
              <div className={`w-3 h-3 rounded-full ${s.color}`} />
              {s.label}
              {status === s.value && <Check size={14} className="ml-auto text-fc-accent" />}
            </button>
          ))}
        </div>
      </div>

      <button onClick={() => save.mutate()} disabled={save.isPending} className="btn-primary">
        {save.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
      </button>
    </div>
  )
}

// ─── APPARENCE ────────────────────────────────────────────────────────────────

function AppearanceSection() {
  const [theme, setThemeState] = useState(() => localStorage.getItem('fc_theme') ?? 'dark')
  const [fontSize, setFontSize] = useState(() => localStorage.getItem('fc_font_size') ?? 'md')
  const [compact, setCompact] = useState(() => localStorage.getItem('fc_compact') === 'true')

  const setTheme = (id: string) => {
    setThemeState(id)
    localStorage.setItem('fc_theme', id)
    document.documentElement.setAttribute('data-theme', id)
  }

  const applyFontSize = (id: string, px: string) => {
    setFontSize(id)
    localStorage.setItem('fc_font_size', id)
    document.documentElement.style.setProperty('--fc-font-size', px)
  }

  const toggleCompact = () => {
    const next = !compact
    setCompact(next)
    localStorage.setItem('fc_compact', String(next))
    document.documentElement.classList.toggle('fc-compact', next)
  }

  return (
    <div className="space-y-8">
      <div>
        <label className="fc-label">Thème</label>
        <div className="grid grid-cols-4 gap-3 mt-3">
          {THEMES.map(t => (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className={`relative flex flex-col rounded-xl border-2 overflow-hidden transition
                ${theme === t.id
                  ? 'border-fc-accent ring-2 ring-fc-accent/30'
                  : 'border-fc-hover hover:border-fc-accent/50'}`}
            >
              {/* Mini-aperçu 3 bandes */}
              <div className="flex h-10 w-full">
                <div className="flex-1" style={{ background: t.preview[0] }} />
                <div className="flex-1" style={{ background: t.preview[1] }} />
                <div className="flex-1" style={{ background: t.preview[2] }} />
              </div>
              {/* Infos thème */}
              <div className="flex items-center gap-1.5 px-2 py-1.5 bg-fc-channel">
                <div
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ background: t.accent }}
                />
                <span className="text-xs font-medium text-fc-text truncate flex-1 text-left">{t.label}</span>
                {theme === t.id && (
                  <div className="w-4 h-4 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                    <Check size={10} className="text-white" />
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="fc-label">Taille de police</label>
        <div className="flex gap-2 mt-2 flex-wrap">
          {FONT_SIZES.map(f => (
            <button
              key={f.id}
              onClick={() => applyFontSize(f.id, f.px)}
              className={`px-4 py-2 rounded-lg border text-sm transition
                ${fontSize === f.id
                  ? 'border-fc-accent bg-fc-accent/10 text-white'
                  : 'border-fc-hover text-fc-muted hover:text-white'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-fc-muted mt-2">
          Aperçu : <span style={{ fontSize: FONT_SIZES.find(f => f.id === fontSize)?.px }}>
            Ceci est un exemple de message.
          </span>
        </p>
      </div>

      <Toggle
        label="Mode compact"
        description="Réduit l'espace entre les messages et masque les avatars groupés"
        value={compact}
        onChange={toggleCompact}
      />
    </div>
  )
}

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────

function NotificationsSection() {
  const [desktopNotif, setDesktopNotif] = useState(
    () => localStorage.getItem('fc_notif_desktop') !== 'false'
  )
  const [sounds, setSounds] = useState(
    () => localStorage.getItem('fc_notif_sounds') !== 'false'
  )
  const [onlyMentions, setOnlyMentions] = useState(
    () => localStorage.getItem('fc_notif_mentions_only') === 'true'
  )

  const save = (key: string, val: boolean) => localStorage.setItem(key, String(val))

  const requestPermission = async () => {
    if ('Notification' in window) {
      const perm = await Notification.requestPermission()
      if (perm === 'granted') {
        toast.success('Notifications activées')
        setDesktopNotif(true)
        save('fc_notif_desktop', true)
      } else {
        toast.error('Permission refusée par le navigateur')
      }
    }
  }

  return (
    <div className="space-y-6">
      <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-white">Notifications bureau</div>
            <div className="text-xs text-fc-muted mt-0.5">
              {Notification.permission === 'granted'
                ? 'Autorisées'
                : Notification.permission === 'denied'
                ? 'Bloquées par le navigateur'
                : 'Non demandées'}
            </div>
          </div>
          {Notification.permission !== 'granted' && (
            <button onClick={requestPermission} className="btn-secondary text-sm">
              Autoriser
            </button>
          )}
          {Notification.permission === 'granted' && (
            <div className="flex items-center gap-1 text-fc-green text-sm">
              <Check size={14} /> Actif
            </div>
          )}
        </div>
      </div>

      <Toggle
        label="Sons de notification"
        description="Jouer un son lors des nouveaux messages"
        value={sounds}
        onChange={v => { setSounds(v); save('fc_notif_sounds', v) }}
      />

      <Toggle
        label="Mentions uniquement"
        description="Ne notifier que pour les @mentions et DMs"
        value={onlyMentions}
        onChange={v => { setOnlyMentions(v); save('fc_notif_mentions_only', v) }}
      />
    </div>
  )
}

// ─── AUDIO & VIDÉO ────────────────────────────────────────────────────────────

function AudioSection() {
  const [inputDevice, setInputDevice] = useState('')
  const [outputDevice, setOutputDevice] = useState('')
  const [inputVol, setInputVol] = useState(100)
  const [outputVol, setOutputVol] = useState(100)
  const [echoCancellation, setEchoCancellation] = useState(true)
  const [noiseSuppression, setNoiseSuppression] = useState(true)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])

  const loadDevices = async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true })
      const list = await navigator.mediaDevices.enumerateDevices()
      setDevices(list)
    } catch {
      toast.error('Impossible d\'accéder aux périphériques audio')
    }
  }

  const inputs = devices.filter(d => d.kind === 'audioinput')
  const outputs = devices.filter(d => d.kind === 'audiooutput')

  return (
    <div className="space-y-6">
      <button onClick={loadDevices} className="btn-secondary text-sm flex items-center gap-2">
        <Mic size={14} /> Détecter les périphériques
      </button>

      {inputs.length > 0 && (
        <Field label="Microphone">
          <select
            value={inputDevice}
            onChange={e => setInputDevice(e.target.value)}
            className="fc-input"
          >
            <option value="">Par défaut</option>
            {inputs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Micro'}</option>)}
          </select>
        </Field>
      )}

      {outputs.length > 0 && (
        <Field label="Sortie audio">
          <select
            value={outputDevice}
            onChange={e => setOutputDevice(e.target.value)}
            className="fc-input"
          >
            <option value="">Par défaut</option>
            {outputs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Sortie'}</option>)}
          </select>
        </Field>
      )}

      <Field label={`Volume micro — ${inputVol}%`}>
        <input
          type="range" min={0} max={100} value={inputVol}
          onChange={e => setInputVol(Number(e.target.value))}
          className="w-full accent-fc-accent"
        />
      </Field>

      <Field label={`Volume sortie — ${outputVol}%`}>
        <input
          type="range" min={0} max={100} value={outputVol}
          onChange={e => setOutputVol(Number(e.target.value))}
          className="w-full accent-fc-accent"
        />
      </Field>

      <Toggle
        label="Annulation d'écho"
        description="Supprime l'écho lors des appels vocaux"
        value={echoCancellation}
        onChange={setEchoCancellation}
      />

      <Toggle
        label="Réduction du bruit"
        description="Filtre les bruits de fond"
        value={noiseSuppression}
        onChange={setNoiseSuppression}
      />
    </div>
  )
}

// ─── VIE PRIVÉE ───────────────────────────────────────────────────────────────

function PrivacySection() {
  const [dmFromAll, setDmFromAll] = useState(
    () => localStorage.getItem('fc_dm_from_all') !== 'false'
  )
  const [showOnline, setShowOnline] = useState(
    () => localStorage.getItem('fc_show_online') !== 'false'
  )
  const [readReceipts, setReadReceipts] = useState(
    () => localStorage.getItem('fc_read_receipts') !== 'false'
  )

  const save = (key: string, val: boolean) => localStorage.setItem(key, String(val))

  return (
    <div className="space-y-6">
      <Toggle
        label="Autoriser les DMs de tout le monde"
        description="Permettre à n'importe quel membre de t'envoyer des messages directs"
        value={dmFromAll}
        onChange={v => { setDmFromAll(v); save('fc_dm_from_all', v) }}
      />

      <Toggle
        label="Afficher mon statut en ligne"
        description="Montrer aux autres que tu es connecté"
        value={showOnline}
        onChange={v => { setShowOnline(v); save('fc_show_online', v) }}
      />

      <Toggle
        label="Accusés de lecture"
        description="Envoyer des confirmations de lecture dans les DMs"
        value={readReceipts}
        onChange={v => { setReadReceipts(v); save('fc_read_receipts', v) }}
      />
    </div>
  )
}

// ─── AVANCÉ ───────────────────────────────────────────────────────────────────

function AdvancedSection({ user }: { user: any }) {
  const nav = useNavigate()

  const copyId = () => {
    navigator.clipboard.writeText(user.id)
    toast.success('ID copié')
  }

  const deleteAccount = async () => {
    if (!confirm('Supprimer définitivement ton compte ? Cette action est irréversible.')) return
    try {
      await api.delete('/users/me')
      localStorage.clear()
      nav('/login')
      toast.success('Compte supprimé')
    } catch {
      toast.error('Impossible de supprimer le compte')
    }
  }

  return (
    <div className="space-y-6">
      <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover">
        <div className="text-xs text-fc-muted mb-1 font-semibold uppercase tracking-wide">ID Utilisateur</div>
        <div className="flex items-center justify-between">
          <code className="text-sm text-fc-text font-mono">{user.id}</code>
          <button onClick={copyId} className="p-1.5 text-fc-muted hover:text-white rounded hover:bg-fc-hover transition">
            <Copy size={14} />
          </button>
        </div>
      </div>

      <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover">
        <div className="text-xs text-fc-muted mb-1 font-semibold uppercase tracking-wide">Plate-forme</div>
        <div className="flex items-center gap-2 text-sm text-fc-text">
          {'__TAURI_INTERNALS__' in window ? <Monitor size={14} /> : <Smartphone size={14} />}
          {'__TAURI_INTERNALS__' in window ? 'Application desktop (Tauri)' : 'Navigateur web'}
        </div>
      </div>

      <div className="border-t border-fc-hover pt-6">
        <h3 className="text-sm font-semibold text-fc-red mb-3">Zone de danger</h3>
        <button
          onClick={deleteAccount}
          className="flex items-center gap-2 px-4 py-2.5 bg-fc-red/10 hover:bg-fc-red/20 border border-fc-red/30 text-fc-red rounded-lg text-sm transition"
        >
          <Trash2 size={14} />
          Supprimer mon compte
        </button>
      </div>
    </div>
  )
}

// ─── Composants réutilisables ─────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="fc-label">{label}</label>
        {hint && <span className="text-xs text-fc-muted">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function Toggle({
  label, description, value, onChange,
}: { label: string; description?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-sm font-medium text-white">{label}</div>
        {description && <div className="text-xs text-fc-muted mt-0.5">{description}</div>}
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors
          ${value ? 'bg-fc-accent' : 'bg-fc-hover'}`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform
          ${value ? 'translate-x-4' : 'translate-x-0'}`} />
      </button>
    </div>
  )
}
