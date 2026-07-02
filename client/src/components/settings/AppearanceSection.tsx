import { useState, useEffect } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Check, RotateCcw } from 'lucide-react'
import api from '../../api/client'
import toast from 'react-hot-toast'

const THEMES = [
  { id: 'dark', label: 'Sombre', accent: '#5865f2', preview: ['#1a1b1e', '#232428', '#36393f'] },
  { id: 'darker', label: 'AMOLED', accent: '#5865f2', preview: ['#000', '#0a0a0a', '#0d0d0d'] },
  { id: 'light', label: 'Clair', accent: '#5865f2', preview: ['#f2f3f5', '#ebedef', '#fff'] },
  { id: 'dracula', label: 'Dracula', accent: '#bd93f9', preview: ['#282a36', '#1e1f2b', '#353746'] },
  { id: 'nord', label: 'Nord', accent: '#5e81ac', preview: ['#2e3440', '#3b4252', '#434c5e'] },
  { id: 'catppuccin', label: 'Catppuccin', accent: '#cba6f7', preview: ['#1e1e2e', '#181825', '#313244'] },
  { id: 'gruvbox', label: 'Gruvbox', accent: '#d65d0e', preview: ['#1d2021', '#282828', '#3c3836'] },
  { id: 'tokyonight', label: 'Tokyo Night', accent: '#7aa2f7', preview: ['#1a1b2e', '#1f2040', '#24283b'] },
  { id: 'onedark', label: 'One Dark', accent: '#61afef', preview: ['#282c34', '#2c313c', '#3b4048'] },
  { id: 'cyberpunk', label: 'Cyberpunk', accent: '#f0e14a', preview: ['#0d0d0d', '#111111', '#161616'] },
  { id: 'monokai', label: 'Monokai', accent: '#a6e22e', preview: ['#272822', '#2d2e2a', '#383830'] },
  { id: 'solarized', label: 'Solarized', accent: '#268bd2', preview: ['#002b36', '#073642', '#0d4a5c'] },
  { id: 'forest', label: 'Forêt', accent: '#6cb340', preview: ['#1a2318', '#1e2a1c', '#243222'] },
  { id: 'ocean', label: 'Océan', accent: '#00d4ff', preview: ['#0f2340', '#0d2238', '#112a47'] },
  { id: 'neon', label: 'Neon', accent: '#00ff88', preview: ['#0a0a14', '#0d0d1a', '#111120'] },
  { id: 'matrix', label: 'Matrix', accent: '#00ff00', preview: ['#000000', '#040804', '#060c06'] },
  // Nouveaux thèmes
  { id: 'rosepine', label: 'Rosé Pine', accent: '#eb6f92', preview: ['#191724', '#26233a', '#403d52'] },
  { id: 'everforest', label: 'Everforest', accent: '#a7c080', preview: ['#2d353b', '#343f44', '#374145'] },
  { id: 'kanagawa', label: 'Kanagawa', accent: '#7e9cd8', preview: ['#1f1f28', '#2a2a37', '#2d2d3f'] },
  { id: 'midnight', label: 'Minuit', accent: '#6272a4', preview: ['#0c0e1a', '#101220', '#151828'] },
  { id: 'sunset', label: 'Coucher de soleil', accent: '#f07050', preview: ['#1a1014', '#22141a', '#27151c'] },
  { id: 'coffee', label: 'Café', accent: '#c87941', preview: ['#1e1510', '#271a12', '#2c1c14'] },
  { id: 'winter', label: 'Hiver', accent: '#3498db', preview: ['#f0f4f8', '#e8f0f8', '#d0e4f0'] },
  { id: 'emerald', label: 'Émeraude', accent: '#2ecc71', preview: ['#0d1f18', '#122820', '#162e22'] },
  { id: 'bloodmoon', label: 'Lune de sang', accent: '#cc2222', preview: ['#120a0a', '#1a0e0e', '#221010'] },
  { id: 'violet', label: 'Violet', accent: '#9b59b6', preview: ['#160d24', '#1e1130', '#221238'] },
  { id: 'slate', label: 'Ardoise', accent: '#5d8aa8', preview: ['#1c2230', '#222c3c', '#263042'] },
  { id: 'retro', label: 'Rétro', accent: '#d4883a', preview: ['#2b2017', '#352a1e', '#3c2e22'] },
]

const FONTS = [
  { name: 'Système', value: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  { name: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { name: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
  { name: 'Trebuchet MS', value: '"Trebuchet MS", Helvetica, sans-serif' },
  { name: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { name: 'Tahoma', value: 'Tahoma, Geneva, sans-serif' },
  { name: 'Courier New', value: '"Courier New", Courier, monospace' },
  { name: 'Consolas', value: 'Consolas, "Courier New", monospace' },
]

const DENSITIES = [
  { id: 'ultra-compact', label: 'Ultra compact' },
  { id: 'compact', label: 'Compact' },
  { id: 'normal', label: 'Normal' },
  { id: 'comfortable', label: 'Confortable' },
]

const AVATAR_SHAPES = [
  { id: 'round', label: 'Rond' },
  { id: 'rounded', label: 'Arrondi' },
  { id: 'square', label: 'Carré' },
]

const MESSAGE_DISPLAYS = [
  { id: 'normal', label: 'Standard' },
  { id: 'compact', label: 'Compact' },
  { id: 'ultra-compact', label: 'Ultra compact' },
]

const CODE_THEMES = [
  'dracula', 'monokai', 'github-dark', 'nord', 'one-dark-pro',
  'solarized-dark', 'tomorrow-night', 'vscode-dark',
]

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${
        value ? 'bg-fc-accent' : 'bg-fc-hover'
      }`}
    >
      <span className={`inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow transition-transform ${
        value ? 'translate-x-4.5' : 'translate-x-0.5'
      }`} />
    </button>
  )
}

function ColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-fc-muted">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value || '#5865f2'}
          onChange={e => onChange(e.target.value)}
          className="w-8 h-8 rounded cursor-pointer border-none bg-transparent"
        />
        <span className="text-xs text-fc-muted font-mono">{value || 'défaut'}</span>
        {value && (
          <button onClick={() => onChange('')} className="text-fc-muted hover:text-white text-xs">
            <RotateCcw size={12} />
          </button>
        )}
      </div>
    </div>
  )
}

export default function AppearanceSection() {
  const [activeTheme, setActiveTheme] = useState(() =>
    localStorage.getItem('fc_theme') || 'dark'
  )

  const { data: settings } = useQuery({
    queryKey: ['user-settings'],
    queryFn: () => api.get('/user/settings').then(r => r.data),
    staleTime: 60_000,
  })

  const [fontFamily, setFontFamily] = useState(FONTS[0].value)
  const [fontSizePx, setFontSizePx] = useState(14)
  const [fontColor, setFontColor] = useState('')
  const [accentColor, setAccentColor] = useState('')
  const [bgColor, setBgColor] = useState('')
  const [density, setDensity] = useState('normal')
  const [avatarShape, setAvatarShape] = useState('round')
  const [sidebarWidth, setSidebarWidth] = useState(240)
  const [glassmorphism, setGlassmorphism] = useState(false)
  const [showRoleColors, setShowRoleColors] = useState(true)
  const [messageDisplay, setMessageDisplay] = useState('normal')
  const [codeTheme, setCodeTheme] = useState('dracula')

  useEffect(() => {
    if (settings) {
      setFontFamily(settings.font_family ?? FONTS[0].value)
      setFontSizePx(settings.font_size_px ?? 14)
      setFontColor(settings.font_color ?? '')
      setAccentColor(settings.accent_color ?? '')
      setBgColor(settings.bg_color ?? '')
      setDensity(settings.interface_density ?? 'normal')
      setAvatarShape(settings.avatar_shape ?? 'round')
      setSidebarWidth(settings.sidebar_width_px ?? 240)
      setGlassmorphism(settings.glassmorphism ?? false)
      setShowRoleColors(settings.show_role_colors ?? true)
      setMessageDisplay(settings.message_display ?? 'normal')
      setCodeTheme(settings.code_theme ?? 'dracula')
    }
  }, [settings])

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.put('/user/settings', data),
    onSuccess: () => toast.success('Apparence sauvegardée'),
    onError: () => toast.error('Erreur de sauvegarde'),
  })

  const applyTheme = (id: string) => {
    setActiveTheme(id)
    localStorage.setItem('fc_theme', id)
    document.documentElement.setAttribute('data-theme', id)
    // Effacer l'override custom pour que la CSS du thème prenne effet
    document.documentElement.style.removeProperty('--fc-accent-rgb')
    setAccentColor('')
  }

  const applyFontSize = (px: number) => {
    setFontSizePx(px)
    document.documentElement.style.setProperty('--fc-font-size', `${px}px`)
  }

  const applyFont = (value: string) => {
    setFontFamily(value)
    document.documentElement.style.setProperty('--fc-font-family', value)
  }

  const save = () => {
    const root = document.documentElement
    if (fontColor) root.style.setProperty('--fc-text', fontColor)
    else root.style.removeProperty('--fc-text')
    if (accentColor) {
      const [r, g, b] = [
        parseInt(accentColor.slice(1, 3), 16),
        parseInt(accentColor.slice(3, 5), 16),
        parseInt(accentColor.slice(5, 7), 16),
      ]
      root.style.setProperty('--fc-accent-rgb', `${r} ${g} ${b}`)
    } else root.style.removeProperty('--fc-accent-rgb')
    if (bgColor) root.style.setProperty('--fc-bg', bgColor)
    else root.style.removeProperty('--fc-bg')
    root.setAttribute('data-glassmorphism', String(glassmorphism))
    root.setAttribute('data-avatar-shape', avatarShape)
    root.setAttribute('data-message-display', messageDisplay)
    localStorage.setItem('fc_sidebar_width', String(sidebarWidth))
    saveMutation.mutate({
      font_family: fontFamily,
      font_size_px: fontSizePx,
      font_color: fontColor || null,
      accent_color: accentColor || null,
      bg_color: bgColor || null,
      interface_density: density,
      avatar_shape: avatarShape,
      sidebar_width_px: sidebarWidth,
      glassmorphism,
      show_role_colors: showRoleColors,
      message_display: messageDisplay,
      code_theme: codeTheme,
    })
  }

  return (
    <div className="space-y-8">
      {/* Thèmes */}
      <section>
        <h3 className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-3">Thème</h3>
        <div className="grid grid-cols-4 gap-2">
          {THEMES.map(theme => (
            <button
              key={theme.id}
              onClick={() => applyTheme(theme.id)}
              title={theme.label}
              className={`relative rounded-lg overflow-hidden border-2 transition ${
                activeTheme === theme.id ? 'border-fc-accent' : 'border-transparent hover:border-fc-hover'
              }`}
            >
              <div className="h-12 flex">
                {theme.preview.map((c, i) => (
                  <div key={i} style={{ background: c }} className="flex-1" />
                ))}
              </div>
              <div className="py-1 bg-fc-channel text-xs text-fc-muted text-center">{theme.label}</div>
              {activeTheme === theme.id && (
                <div className="absolute top-1 right-1 bg-fc-accent rounded-full p-0.5">
                  <Check size={8} className="text-white" />
                </div>
              )}
            </button>
          ))}
        </div>
      </section>

      {/* Police */}
      <section>
        <h3 className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-3">Police d'écriture</h3>
        <div className="grid grid-cols-2 gap-2">
          {FONTS.map(font => (
            <button
              key={font.name}
              onClick={() => applyFont(font.value)}
              style={{ fontFamily: font.value }}
              className={`px-3 py-2 rounded-lg text-sm border transition text-left ${
                fontFamily === font.value
                  ? 'border-fc-accent bg-fc-accent/10 text-white'
                  : 'border-fc-hover text-fc-muted hover:text-white hover:border-fc-hover'
              }`}
            >
              {font.name}
            </button>
          ))}
        </div>
      </section>

      {/* Taille */}
      <section>
        <h3 className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-3">
          Taille de police — <span className="text-white">{fontSizePx}px</span>
        </h3>
        <input
          type="range" min={10} max={24} value={fontSizePx}
          onChange={e => applyFontSize(Number(e.target.value))}
          className="w-full accent-fc-accent"
        />
        <div className="flex justify-between text-xs text-fc-muted mt-1">
          <span>10px</span><span>24px</span>
        </div>
      </section>

      {/* Couleurs */}
      <section>
        <h3 className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-3">Couleurs personnalisées</h3>
        <div className="space-y-3 p-4 bg-fc-channel rounded-xl border border-fc-hover">
          <ColorPicker label="Couleur d'accent" value={accentColor} onChange={setAccentColor} />
          <ColorPicker label="Couleur du texte" value={fontColor} onChange={setFontColor} />
          <ColorPicker label="Couleur de fond" value={bgColor} onChange={setBgColor} />
        </div>
      </section>

      {/* Densité */}
      <section>
        <h3 className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-3">Densité d'interface</h3>
        <div className="grid grid-cols-2 gap-2">
          {DENSITIES.map(d => (
            <button
              key={d.id}
              onClick={() => {
                setDensity(d.id)
                document.documentElement.setAttribute('data-density', d.id)
                localStorage.setItem('fc_density', d.id)
              }}
              className={`px-3 py-2 rounded-lg text-sm border transition ${
                density === d.id
                  ? 'border-fc-accent bg-fc-accent/10 text-white'
                  : 'border-fc-hover text-fc-muted hover:text-white'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </section>

      {/* Affichage messages */}
      <section>
        <h3 className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-3">Mode d'affichage des messages</h3>
        <div className="grid grid-cols-3 gap-2">
          {MESSAGE_DISPLAYS.map(m => (
            <button
              key={m.id}
              onClick={() => setMessageDisplay(m.id)}
              className={`px-3 py-2 rounded-lg text-sm border transition ${
                messageDisplay === m.id
                  ? 'border-fc-accent bg-fc-accent/10 text-white'
                  : 'border-fc-hover text-fc-muted hover:text-white'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </section>

      {/* Avatar + Sidebar */}
      <section>
        <h3 className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-3">Forme des avatars</h3>
        <div className="flex gap-2">
          {AVATAR_SHAPES.map(s => (
            <button
              key={s.id}
              onClick={() => setAvatarShape(s.id)}
              className={`flex-1 px-3 py-2 rounded-lg text-sm border transition ${
                avatarShape === s.id
                  ? 'border-fc-accent bg-fc-accent/10 text-white'
                  : 'border-fc-hover text-fc-muted hover:text-white'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-3">
          Largeur de la barre latérale — <span className="text-white">{sidebarWidth}px</span>
        </h3>
        <input
          type="range" min={180} max={400} value={sidebarWidth}
          onChange={e => setSidebarWidth(Number(e.target.value))}
          className="w-full accent-fc-accent"
        />
      </section>

      {/* Thème de code */}
      <section>
        <h3 className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-3">Thème blocs de code</h3>
        <select
          value={codeTheme}
          onChange={e => setCodeTheme(e.target.value)}
          className="w-full bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white"
        >
          {CODE_THEMES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </section>

      {/* Toggles */}
      <section>
        <h3 className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-3">Options d'interface</h3>
        <div className="space-y-3 p-4 bg-fc-channel rounded-xl border border-fc-hover">
          <div className="flex items-center justify-between">
            <span className="text-sm text-white">Effet vitré (Glassmorphism)</span>
            <Toggle value={glassmorphism} onChange={setGlassmorphism} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-white">Couleurs des rôles</span>
            <Toggle value={showRoleColors} onChange={setShowRoleColors} />
          </div>
        </div>
      </section>

      <button
        onClick={save}
        disabled={saveMutation.isPending}
        className="w-full py-2.5 bg-fc-accent hover:bg-fc-accent/80 text-white rounded-lg font-medium text-sm transition disabled:opacity-50"
      >
        {saveMutation.isPending ? 'Sauvegarde...' : 'Sauvegarder l\'apparence'}
      </button>
    </div>
  )
}
