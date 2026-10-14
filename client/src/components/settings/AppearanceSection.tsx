import { useState, useEffect, type ReactNode } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { RotateCcw } from 'lucide-react'
import api from '../../api/client'
import toast from 'react-hot-toast'
import { useT, type Key } from '../../i18n'
import { SIDEBAR_MIN, SIDEBAR_MAX, SIDEBAR_DEFAULT } from '../../constants/layout'
import { DEFAULT_THEME_ID, isHex, type CustomTheme } from '../../theme/themeCore'
import { DEFAULT_LAYOUT } from '../../theme/applyTheme'
import { useThemeStore } from '../../theme/themeStore'
import { FONTS, fontId } from '../../theme/fonts'
import { Toggle } from './shared'
import { confirm } from '../ui/ConfirmModal'
import ThemeGallery from './appearance/ThemeGallery'
import ThemeEditor from './appearance/ThemeEditor'
import LayoutSettings from './appearance/LayoutSettings'
import AppIconPicker from './appearance/AppIconPicker'

const AVATAR_SHAPES: { id: string; label: Key }[] = [
  { id: 'round', label: 'settings.appearance.round' },
  { id: 'rounded', label: 'settings.appearance.rounded' },
  { id: 'squircle', label: 'looksMore.avatar.squircle' },
  { id: 'square', label: 'settings.appearance.square' },
]

const CODE_THEMES = [
  'dracula', 'monokai', 'github-dark', 'nord', 'one-dark-pro',
  'solarized-dark', 'tomorrow-night', 'vscode-dark',
]

const ACCENTS = ['#5865f2', '#00a8fc', '#23a55a', '#f0b232', '#e67e22', '#f23f43', '#eb6f92', '#9b59b6', '#1abc9c', '#ffffff']

const H = ({ children }: { children: ReactNode }) => (
  <h3 className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-3">{children}</h3>
)

/** Accent du compte (accent_color) : remplace celui des thèmes prédéfinis, partagé avec le mobile. */
function AccentPicker() {
  const t = useT()
  const { accent, setAccent } = useThemeStore()
  const save = (c: string | null) => {
    setAccent(c)
    api.put('/user/settings', { accent_color: c }).catch(() => toast.error(t('settings.appearance.saveError')))
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button onClick={() => save(null)} aria-pressed={!accent}
        className={`px-3 h-8 rounded-full text-xs border ${!accent ? 'border-fc-accent text-fc-text' : 'border-fc-hover text-fc-muted'}`}>
        {t('themes.accentTheme')}
      </button>
      {ACCENTS.map(c => (
        <button key={c} onClick={() => save(c)} aria-pressed={accent === c} aria-label={c} title={c}
          className={`w-8 h-8 rounded-full border-2 ${accent === c ? 'border-fc-text' : 'border-transparent'}`} style={{ background: c }} />
      ))}
      <input type="color" value={accent && isHex(accent) ? accent : '#5865f2'} aria-label={t('themes.accentCustom')}
        onChange={e => save(e.target.value)} className="w-8 h-8 rounded-full cursor-pointer border border-fc-hover bg-transparent p-0" />
    </div>
  )
}

export default function AppearanceSection() {
  const t = useT()
  const name = (s: string) => t(s as Key)
  const [editing, setEditing] = useState<CustomTheme | null>(null)

  const { data: settings, refetch } = useQuery({
    queryKey: ['user-settings'],
    queryFn: () => api.get('/user/settings').then(r => r.data),
    staleTime: 60_000,
  })

  const [font, setFont] = useState<string>('system')
  const [fontSizePx, setFontSizePx] = useState(14)
  const [avatarShape, setAvatarShape] = useState('round')
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT)
  const [showRoleColors, setShowRoleColors] = useState(true)
  const [codeTheme, setCodeTheme] = useState('dracula')

  useEffect(() => {
    if (!settings) return
    setFont(fontId(settings.font_family))
    setFontSizePx(settings.font_size_px ?? 14)
    setAvatarShape(settings.avatar_shape ?? 'round')
    setSidebarWidth(settings.sidebar_width_px ?? SIDEBAR_DEFAULT)
    setShowRoleColors(settings.show_role_colors ?? true)
    setCodeTheme(settings.code_theme ?? 'dracula')
  }, [settings])

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.put('/user/settings', data),
    onSuccess: () => { toast.success(t('settings.appearance.saved')); refetch() },
    onError: () => toast.error(t('settings.appearance.saveError')),
  })

  const stack = FONTS.find(f => f.id === font)?.stack ?? FONTS[0].stack
  const applyFont = (id: string) => {
    setFont(id)
    document.documentElement.style.setProperty('--fc-font-family', FONTS.find(f => f.id === id)?.stack ?? FONTS[0].stack)
  }
  const applyFontSize = (px: number) => {
    setFontSizePx(px)
    document.documentElement.style.setProperty('--fc-font-size', `${px}px`)
  }

  const save = () => {
    document.documentElement.setAttribute('data-avatar-shape', avatarShape)
    localStorage.setItem('fc_sidebar_width', String(sidebarWidth))
    saveMutation.mutate({
      font_family: stack,
      font_size_px: fontSizePx,
      avatar_shape: avatarShape,
      sidebar_width_px: sidebarWidth,
      show_role_colors: showRoleColors,
      code_theme: codeTheme,
    })
  }

  /** Tout revient à l'apparence d'origine (les thèmes perso enregistrés sont conservés). */
  const resetAll = async () => {
    if (!(await confirm({ message: t('themes.resetAllConfirm'), confirmLabel: t('themes.resetAll') }))) return
    const s = useThemeStore.getState()
    s.select(DEFAULT_THEME_ID)
    s.setAccent(null)
    s.setLayout(DEFAULT_LAYOUT)
    s.setDensity('normal')
    applyFont('system')
    applyFontSize(14)
    saveMutation.mutate({ accent_color: null, interface_density: 'normal', font_family: FONTS[0].stack, font_size_px: 14 })
  }

  if (editing) {
    return (
      <div className="space-y-4">
        <H>{t('themes.editorTitle')}</H>
        <ThemeEditor initial={editing} onClose={() => setEditing(null)} />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <section>
        <H>{t('settings.appearance.theme')}</H>
        <ThemeGallery onEdit={setEditing} />
      </section>

      <section>
        <H>{t('settings.appearance.accent')}</H>
        <AccentPicker />
        <p className="text-xs text-fc-muted mt-2">{t('themes.accentHint')}</p>
      </section>

      <section>
        <H>{t('layout.title')}</H>
        <LayoutSettings />
      </section>

      <section>
        <H>{t('appIcon.title')}</H>
        <AppIconPicker />
      </section>

      <section>
        <H>{t('settings.appearance.font')}</H>
        <p className="text-xs text-fc-muted mb-2">{t('fonts.hint')}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {FONTS.map(f => (
            <button key={f.id} onClick={() => applyFont(f.id)} style={{ fontFamily: f.stack }}
              className={`px-3 py-2 rounded-lg text-sm border transition text-left ${font === f.id ? 'border-fc-accent bg-fc-accent/10 text-fc-text' : 'border-fc-hover text-fc-muted hover:text-white'}`}>
              {name(f.label)}
            </button>
          ))}
        </div>
      </section>

      <section>
        <H>{t('settings.appearance.fontSize')} — <span className="text-fc-text">{fontSizePx}px</span></H>
        <input type="range" min={10} max={24} value={fontSizePx} aria-label={t('settings.appearance.fontSize')}
          onChange={e => applyFontSize(Number(e.target.value))} className="w-full accent-fc-accent" />
        <div className="flex justify-between text-xs text-fc-muted mt-1"><span>10px</span><span>24px</span></div>
      </section>

      <section>
        <H>{t('settings.appearance.avatarShape')}</H>
        <div className="flex gap-2">
          {AVATAR_SHAPES.map(s => (
            <button key={s.id} onClick={() => setAvatarShape(s.id)}
              className={`flex-1 px-3 py-2 rounded-lg text-sm border transition ${avatarShape === s.id ? 'border-fc-accent bg-fc-accent/10 text-fc-text' : 'border-fc-hover text-fc-muted hover:text-white'}`}>
              {t(s.label)}
            </button>
          ))}
        </div>
      </section>

      <section>
        <H>{t('settings.appearance.sidebarWidth')} — <span className="text-fc-text">{sidebarWidth}px</span></H>
        <input type="range" min={SIDEBAR_MIN} max={SIDEBAR_MAX} value={sidebarWidth} aria-label={t('settings.appearance.sidebarWidth')}
          onChange={e => setSidebarWidth(Number(e.target.value))} className="w-full accent-fc-accent" />
      </section>

      <section>
        <H>{t('settings.appearance.codeTheme')}</H>
        <select aria-label={t('settings.appearance.codeTheme')} value={codeTheme} onChange={e => setCodeTheme(e.target.value)}
          className="w-full bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-fc-text">
          {CODE_THEMES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </section>

      <section>
        <H>{t('settings.appearance.options')}</H>
        <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover flex items-center justify-between">
          <span className="text-sm text-fc-text">{t('settings.appearance.roleColors')}</span>
          <Toggle value={showRoleColors} onChange={setShowRoleColors} label={t('settings.appearance.roleColors')} />
        </div>
      </section>

      <div className="flex flex-col sm:flex-row gap-2">
        <button onClick={save} disabled={saveMutation.isPending}
          className="flex-1 py-2.5 bg-fc-accent hover:bg-fc-accent/80 text-white rounded-lg font-medium text-sm transition disabled:opacity-50">
          {saveMutation.isPending ? t('common.saving') : t('settings.appearance.save')}
        </button>
        <button onClick={() => { void resetAll() }} className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-sm border border-fc-hover text-fc-muted hover:text-white">
          <RotateCcw size={14} /> {t('themes.resetAll')}
        </button>
      </div>
    </div>
  )
}
