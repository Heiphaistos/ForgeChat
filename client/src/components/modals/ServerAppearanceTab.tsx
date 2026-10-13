// Paramètres du serveur > Apparence : ce que tous les membres voient dans ce serveur
// (bannière, accents, fonds, nom, icône, accueil, non-lus, rôles), avec aperçu en direct.
// Enregistré par PUT /servers/:id/look, validé strictement côté serveur
// (server/src/models/server_look.rs). Chaque membre peut refuser l'apparence chez lui,
// sauf si le propriétaire l'impose.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ImagePlus, RotateCcw } from 'lucide-react'
import api from '../../api/client'
import { useT, type Key } from '../../i18n'
import { confirm } from '../ui/ConfirmModal'
import ProfileBanner from '../ui/ProfileBanner'
import ServerIcon from '../ui/ServerIcon'
import StyledNameText from '../ui/StyledNameText'
import LookBackdrop from '../ui/LookBackdrop'
import { RoleMark } from '../../hooks/useRoleDecor'
import { useLookOptOut } from '../../hooks/useServerAppearance'
import { NAME_EFFECTS, NAME_FONTS, colorFromInput, hex } from '../../lib/nameStyle'
import {
  BANNER_HEIGHTS, BANNER_OVERLAYS, BG_KINDS, BG_PATTERNS, BLUR_MAX, DEFAULT_BANNER, ICON_RINGS, ICON_SHAPES,
  ROLE_DISPLAYS, WELCOME_STYLES, accentFill, accentVars, bannerBounds, bannerFocus, bannerOverlayCss, cleanAppearance,
  setOptedOut, type BgKind, type BgPattern, type LookBackground, type ServerAppearance,
} from '../../lib/serverAppearance'

const LOOK_IMAGE_MAX = 10 * 1024 * 1024

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-fc-hover pt-5">
      <div>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        {hint && <p className="text-xs text-fc-muted mt-0.5">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-wrap items-center justify-between gap-2 text-sm text-fc-text">
      <span className="min-w-0">{label}</span>
      <span className="flex items-center gap-2">{children}</span>
    </label>
  )
}

const selectCls = 'bg-fc-input text-white text-sm rounded px-2 py-1.5 outline-none focus:ring-2 focus:ring-fc-accent max-w-[14rem]'

/** Couleur optionnelle : sélecteur natif + bouton pour la retirer. */
function ColorField({ label, value, onChange, disabled }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; disabled?: boolean }) {
  const t = useT()
  return (
    <Row label={label}>
      <input
        type="color"
        aria-label={label}
        disabled={disabled}
        value={hex(value ?? 0x5865f2)}
        onChange={e => onChange(colorFromInput(e.target.value) ?? undefined)}
        className={`w-9 h-7 rounded bg-transparent border border-fc-hover cursor-pointer disabled:opacity-50 ${value == null ? 'opacity-40' : ''}`}
      />
      {value != null && !disabled && (
        <button type="button" onClick={() => onChange(undefined)} className="text-xs text-fc-muted hover:text-white underline">{t('srvLook.clear')}</button>
      )}
    </Row>
  )
}

function Slider({ label, value, min, max, onChange, disabled, unit = '' }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; disabled?: boolean; unit?: string }) {
  return (
    <Row label={label}>
      <input type="range" min={min} max={max} value={value} disabled={disabled} aria-label={label}
        onChange={e => onChange(Number(e.target.value))} className="w-36 accent-fc-accent" />
      <span className="text-xs text-fc-muted w-10 text-right tabular-nums">{value}{unit}</span>
    </Row>
  )
}

function Choice<T extends string>({ label, value, options, labelKey, onChange, disabled }: {
  label: string; value: T; options: readonly T[]; labelKey: (v: T) => Key; onChange: (v: T) => void; disabled?: boolean
}) {
  const t = useT()
  return (
    <Row label={label}>
      <select className={selectCls} value={value} disabled={disabled} aria-label={label} onChange={e => onChange(e.target.value as T)}>
        {options.map(o => <option key={o} value={o}>{t(labelKey(o))}</option>)}
      </select>
    </Row>
  )
}

/** Éditeur d'un fond (couleur, dégradé, motif, image envoyée au serveur). */
function BackgroundEditor({ serverId, title, value, onChange, disabled }: {
  serverId: string; title: string; value: LookBackground | undefined; onChange: (v: LookBackground | undefined) => void; disabled?: boolean
}) {
  const t = useT()
  const fileRef = useRef<HTMLInputElement>(null)
  const kind: BgKind = value?.kind ?? 'none'
  const base = (k: BgKind): LookBackground | undefined => {
    if (k === 'none') return undefined
    const keep = { angle: value?.angle ?? 135, opacity: value?.opacity ?? (k === 'image' ? 35 : 100), blur: value?.blur ?? 0 }
    if (k === 'color') return { kind: k, color: value?.color ?? 0x2b2d31, ...keep }
    if (k === 'gradient') return { kind: k, color: value?.color ?? 0x5865f2, color2: value?.color2 ?? 0xeb459e, ...keep }
    if (k === 'pattern') return { kind: k, color: value?.color ?? 0xffffff, pattern: value?.pattern ?? 'dots', ...keep, opacity: value?.opacity ?? 15 }
    return value?.image ? { kind: k, image: value.image, ...keep } : undefined
  }
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData()
      form.append('file', file)
      const { data } = await api.post<{ url: string }>(`/servers/${serverId}/look/image`, form)
      return data.url
    },
    onSuccess: url => onChange({ kind: 'image', image: url, angle: 0, opacity: value?.opacity ?? 35, blur: value?.blur ?? 0 }),
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('common.error')),
  })
  const set = (patch: Partial<LookBackground>) => value && onChange({ ...value, ...patch })
  return (
    <Section title={title}>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={title}>
        {BG_KINDS.map(k => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            disabled={disabled}
            onClick={() => (k === 'image' && !value?.image ? fileRef.current?.click() : onChange(base(k)))}
            className={`px-2.5 py-1 rounded text-xs font-medium transition disabled:opacity-50 ${kind === k ? 'bg-fc-accent text-white' : 'bg-fc-input text-fc-muted hover:text-white'}`}
          >
            {t(`srvLook.bg.${k}` as Key)}
          </button>
        ))}
      </div>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden"
        onChange={e => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          if (f.size > LOOK_IMAGE_MAX) { toast.error(t('srvLook.bgImageHint')); return }
          upload.mutate(f)
        }}
      />
      {value && (value.kind === 'color' || value.kind === 'gradient' || value.kind === 'pattern') && (
        <ColorField label={t('srvLook.bgColor')} value={value.color} disabled={disabled} onChange={c => c != null && set({ color: c })} />
      )}
      {value?.kind === 'gradient' && (
        <>
          <ColorField label={t('srvLook.bgColor2')} value={value.color2} disabled={disabled} onChange={c => c != null && set({ color2: c })} />
          <Slider label={t('srvLook.bgAngle')} value={value.angle} min={0} max={360} unit="°" disabled={disabled} onChange={v => set({ angle: v })} />
        </>
      )}
      {value?.kind === 'pattern' && (
        <>
          <Choice label={t('srvLook.bg.pattern')} value={value.pattern ?? 'dots'} options={BG_PATTERNS} disabled={disabled}
            labelKey={p => `srvLook.pattern.${p}` as Key} onChange={(p: BgPattern) => set({ pattern: p })} />
          <ColorField label={t('srvLook.bgPatternBase')} value={value.color2} disabled={disabled} onChange={c => set({ color2: c })} />
        </>
      )}
      {value?.kind === 'image' && (
        <>
          <button type="button" disabled={disabled || upload.isPending} onClick={() => fileRef.current?.click()}
            className="flex items-center gap-2 px-3 py-1.5 rounded bg-fc-input text-sm text-fc-text hover:text-white disabled:opacity-50">
            <ImagePlus size={14} aria-hidden /> {upload.isPending ? t('srvLook.bgUploading') : t('srvLook.bgUpload')}
          </button>
          <Slider label={t('srvLook.bgBlur')} value={value.blur} min={0} max={BLUR_MAX} unit="px" disabled={disabled} onChange={v => set({ blur: v })} />
        </>
      )}
      {kind === 'image' && <p className="text-xs text-fc-muted">{t('srvLook.bgImageHint')}</p>}
      {value && <Slider label={t('srvLook.bgOpacity')} value={value.opacity} min={0} max={100} unit="%" disabled={disabled} onChange={v => set({ opacity: v })} />}
    </Section>
  )
}

/** Aperçu en direct : en-tête (bannière ou accent), liste des salons, zone des messages. */
function Preview({ look, server }: { look: ServerAppearance; server: { name: string; icon?: string | null; banner?: string | null } }) {
  const t = useT()
  const bounds = bannerBounds(look.banner)
  const overlay = bannerOverlayCss(look.banner, look.accent) as CSSProperties | undefined
  const fill = accentFill(look)
  const unread = look.unread_color != null ? hex(look.unread_color) : '#ffffff'
  return (
    <div className="rounded-xl overflow-hidden border border-fc-hover flex text-xs" style={accentVars(look) as CSSProperties | undefined} aria-label={t('srvLook.preview')}>
      <div className="relative w-[46%] min-w-[150px] bg-fc-channel flex flex-col">
        <LookBackdrop bg={look.sidebar_bg} />
        <div className="relative">
          {server.banner ? (
            <ProfileBanner src={server.banner} minHeight={Math.round(bounds.min * 0.7)} maxHeight={Math.round(bounds.max * 0.7)} focus={bannerFocus(look.banner)}>
              {overlay && <div className="absolute inset-0" style={overlay} />}
              <div className="absolute inset-x-0 bottom-0 px-2 py-1">
                <StyledNameText text={server.name} style={look.name ?? null} className="font-semibold text-white truncate drop-shadow" />
              </div>
            </ProfileBanner>
          ) : (
            <div className="flex items-center gap-2 px-2 py-2" style={fill ? { background: fill } : undefined}>
              <ServerIcon name={server.name} icon={server.icon} look={look} size={22} />
              <StyledNameText text={server.name} style={look.name ?? null} className="font-semibold text-white truncate" />
            </div>
          )}
        </div>
        <div className="relative p-2 space-y-1">
          <div className="flex items-center gap-1.5 text-white"><span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: unread }} /># général</div>
          <div className="text-fc-muted"># annonces</div>
          <div className="text-fc-muted"># médias</div>
        </div>
      </div>
      <div className="relative flex-1 min-w-0 bg-fc-bg p-3 space-y-2">
        <LookBackdrop bg={look.message_bg} />
        <div className="relative flex items-start gap-2">
          <ServerIcon name={server.name} icon={server.icon} look={look} size={28} />
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <span className="font-semibold" style={look.role_display ? undefined : { color: '#e67e22' }}>Momo</span>
              {look.role_display && <RoleMark mark={{ kind: look.role_display === 'dot' ? 'dot' : 'badge', color: 0xe67e22, name: 'Modo' }} />}
            </div>
            <p className="text-fc-text">{t('srvLook.previewMessage')}</p>
          </div>
        </div>
        <span className="relative inline-block px-2 py-1 rounded text-white bg-fc-accent" style={fill ? { background: fill } : undefined}>#général</span>
      </div>
    </div>
  )
}

export default function ServerAppearanceTab({ serverId, canEdit }: { serverId: string; canEdit: boolean }) {
  const t = useT()
  const qc = useQueryClient()
  const { data } = useQuery<{ server?: { name: string; icon?: string | null; banner?: string | null; look?: unknown } }>({
    queryKey: ['server', serverId],
    queryFn: () => api.get(`/servers/${serverId}`).then(r => r.data),
    staleTime: 60_000,
  })
  const server = data?.server
  const saved = cleanAppearance(server?.look)
  const [look, setLook] = useState<ServerAppearance>(() => saved ?? {})
  const [dirty, setDirty] = useState(false)
  // Apparence reçue (ou changée par un autre administrateur) : reprise tant que rien n'est modifié ici.
  const savedKey = JSON.stringify(saved ?? {})
  useEffect(() => { if (!dirty) setLook(JSON.parse(savedKey) as ServerAppearance) }, [savedKey, dirty])
  const optedOut = useLookOptOut(serverId)

  const patch = (p: Partial<ServerAppearance>) => { setLook(l => ({ ...l, ...p })); setDirty(true) }
  const banner = look.banner ?? DEFAULT_BANNER
  const setBanner = (p: Partial<typeof banner>) => patch({ banner: { ...banner, ...p } })
  const name = look.name ?? { colors: [], angle: 90 }
  const setName = (p: Partial<typeof name>) => patch({ name: { ...name, ...p } })

  const save = useMutation({
    mutationFn: (body: ServerAppearance | null) => api.put(`/servers/${serverId}/look`, body),
    onSuccess: () => {
      setDirty(false)
      qc.invalidateQueries({ queryKey: ['server', serverId] })
      qc.invalidateQueries({ queryKey: ['servers'] })
      toast.success(t('srvLook.saved'))
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('common.error')),
  })
  const disabled = !canEdit || save.isPending

  if (!server) return null
  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h2 className="text-xl font-bold text-white">{t('srvLook.title')}</h2>
        <p className="text-sm text-fc-muted mt-1">{t('srvLook.intro')}</p>
        {!canEdit && <p className="text-xs text-fc-muted mt-2">{t('srvLook.readOnly')}</p>}
      </div>

      <Preview look={look} server={server} />

      {/* Refus par membre (cet appareil), sauf apparence imposée */}
      {saved && (saved.enforce
        ? <p className="text-xs text-fc-muted">{t('srvLook.enforced')}</p>
        : (
          <label className="flex items-start gap-2 text-sm text-fc-text cursor-pointer">
            <input type="checkbox" className="mt-1 accent-fc-accent" checked={optedOut} onChange={e => setOptedOut(serverId, e.target.checked)} />
            <span>{t('srvLook.optOut')}<span className="block text-xs text-fc-muted">{t('srvLook.optOutHint')}</span></span>
          </label>
        ))}

      {canEdit && (
        <>
          <Section title={t('srvLook.banner')} hint={t('srvLook.bannerHint')}>
            {!server.banner && <p className="text-xs text-fc-muted">{t('srvLook.noBanner')}</p>}
            <Choice label={t('srvLook.bannerHeight')} value={banner.height} options={BANNER_HEIGHTS} disabled={disabled}
              labelKey={h => `srvLook.height.${h}` as Key} onChange={height => setBanner({ height })} />
            <Slider label={t('srvLook.focusX')} value={banner.focus_x} min={0} max={100} unit="%" disabled={disabled} onChange={focus_x => setBanner({ focus_x })} />
            <Slider label={t('srvLook.focusY')} value={banner.focus_y} min={0} max={100} unit="%" disabled={disabled} onChange={focus_y => setBanner({ focus_y })} />
            <Choice label={t('srvLook.overlay')} value={banner.overlay} options={BANNER_OVERLAYS} disabled={disabled}
              labelKey={o => `srvLook.overlay.${o}` as Key} onChange={overlay => setBanner({ overlay })} />
            {banner.overlay !== 'none' && (
              <Slider label={t('srvLook.overlayStrength')} value={banner.overlay_strength} min={0} max={100} unit="%" disabled={disabled} onChange={overlay_strength => setBanner({ overlay_strength })} />
            )}
          </Section>

          <Section title={t('srvLook.colors')}>
            <ColorField label={t('srvLook.accent')} value={look.accent} disabled={disabled} onChange={accent => patch({ accent, ...(accent == null ? { accent2: undefined } : {}) })} />
            {look.accent != null && <ColorField label={t('srvLook.accent2')} value={look.accent2} disabled={disabled} onChange={accent2 => patch({ accent2 })} />}
            <ColorField label={t('srvLook.unread')} value={look.unread_color} disabled={disabled} onChange={unread_color => patch({ unread_color })} />
          </Section>

          <Section title={t('srvLook.name')}>
            <ColorField label={t('srvLook.nameColor')} value={name.colors[0]} disabled={disabled}
              onChange={c => setName({ colors: c == null ? [] : [c, ...name.colors.slice(1, 2)] })} />
            {name.colors.length > 0 && (
              <ColorField label={t('srvLook.nameColor2')} value={name.colors[1]} disabled={disabled}
                onChange={c => setName({ colors: c == null ? name.colors.slice(0, 1) : [name.colors[0], c] })} />
            )}
            <Choice label={t('srvLook.nameFont')} value={name.font ?? ''} options={NAME_FONTS} disabled={disabled}
              labelKey={f => `profileId.font.${f || 'default'}` as Key} onChange={font => setName({ font: font || undefined })} />
            <Choice label={t('srvLook.nameEffect')} value={name.effect ?? ''} options={NAME_EFFECTS} disabled={disabled}
              labelKey={e => `profileId.effect.${e || 'none'}` as Key} onChange={effect => setName({ effect: effect || undefined })} />
          </Section>

          <Section title={t('srvLook.icon')}>
            <Choice label={t('srvLook.iconShape')} value={look.icon_shape ?? 'circle'} options={ICON_SHAPES} disabled={disabled}
              labelKey={s => `srvLook.shape.${s}` as Key} onChange={icon_shape => patch({ icon_shape })} />
            <Choice label={t('srvLook.iconRing')} value={look.icon_ring ?? 'none'} options={ICON_RINGS} disabled={disabled}
              labelKey={r => `srvLook.ring.${r}` as Key} onChange={icon_ring => patch({ icon_ring })} />
            {look.icon_ring && look.icon_ring !== 'none' && (
              <ColorField label={t('srvLook.ringColor')} value={look.icon_ring_color} disabled={disabled} onChange={icon_ring_color => patch({ icon_ring_color })} />
            )}
          </Section>

          <BackgroundEditor serverId={serverId} title={t('srvLook.sidebarBg')} value={look.sidebar_bg} disabled={disabled} onChange={sidebar_bg => patch({ sidebar_bg })} />
          <BackgroundEditor serverId={serverId} title={t('srvLook.messageBg')} value={look.message_bg} disabled={disabled} onChange={message_bg => patch({ message_bg })} />

          <Section title={t('srvLook.welcome')}>
            <Choice label={t('srvLook.welcome')} value={look.welcome ?? 'classic'} options={WELCOME_STYLES} disabled={disabled}
              labelKey={w => `srvLook.welcome.${w}` as Key} onChange={welcome => patch({ welcome })} />
            <Choice label={t('srvLook.roles')} value={look.role_display ?? 'name'} options={ROLE_DISPLAYS} disabled={disabled}
              labelKey={r => `srvLook.roles.${r}` as Key} onChange={role_display => patch({ role_display })} />
          </Section>

          <Section title={t('srvLook.enforce')} hint={t('srvLook.enforceHint')}>
            <label className="flex items-center gap-2 text-sm text-fc-text cursor-pointer">
              <input type="checkbox" className="accent-fc-accent" checked={!!look.enforce} disabled={disabled} onChange={e => patch({ enforce: e.target.checked })} />
              {t('srvLook.enforce')}
            </label>
          </Section>

          <div className="flex flex-wrap gap-2 pt-2 sticky bottom-0 bg-fc-bg/95 py-3">
            <button type="button" disabled={disabled || !dirty} onClick={() => save.mutate(cleanAppearance(look))}
              className="px-4 py-2 rounded bg-fc-accent text-white text-sm font-medium disabled:opacity-50">
              {t('srvLook.save')}
            </button>
            <button type="button" disabled={disabled || (!saved && !dirty)}
              onClick={() => { void confirm(t('srvLook.resetConfirm')).then(ok => { if (ok) { setLook({}); save.mutate(null) } }) }}
              className="flex items-center gap-1.5 px-3 py-2 rounded bg-fc-input text-fc-muted hover:text-white text-sm disabled:opacity-50">
              <RotateCcw size={14} aria-hidden /> {t('srvLook.reset')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
