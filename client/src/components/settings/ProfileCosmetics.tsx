import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { mediaUrl } from '../../api/client'
import { Field, Toggle } from './shared'
import { useT, type Key } from '../../i18n'
import { AvatarDecoration, DECORATIONS, DECO_GROUPS, FX_GROUPS, PROFILE_EFFECTS, ProfileEffect, hexColor, type ProfileFx } from '../ui/ProfileDecor'
import {
  DECO_OPTS_DEFAULT, DECO_RANGES, FX_INTENSITY, cleanDecoOpts, cleanIntensity, decoOptsPayload, isDefaultDecoOpts, matches, searchKey,
  type DecoNumKey, type DecoOpts,
} from '../../lib/profileDecor'
import AvatarRing, { cleanRing, type AvatarRingData } from '../ui/AvatarRing'
import AvatarRingFields from './AvatarRingFields'
import ProfileCardFields, { ProfileCardPreview } from './ProfileCardFields'
import { cardPayload, cleanCard, type ProfileCard } from '../../lib/profileCard'
import { useDraft, type DraftReport } from './profileDraft'

interface Props {
  user: any
  /** Brouillon remonté à ProfileSection (enregistrement unique, profileDraft.ts). */
  report: DraftReport
  /** Nom affiché dans l'aperçu (brouillon de l'identité compris). */
  previewName: string
}

const toInt = (hex: string) => parseInt(hex.slice(1), 16)
const DECO_BY_ID = new Map(DECORATIONS.map(d => [d.id, d]))
const FX_BY_ID = new Map(PROFILE_EFFECTS.map(f => [f.id, f]))

/**
 * Vignette fixe d'un effet : ses glyphes dans ses couleurs, ou le calque de l'effet figé.
 * L'animation ne joue qu'au survol ou au focus (profileStyles.css, .fc-pick) ; l'effet complet
 * se joue dans l'aperçu de la fiche quand on le choisit.
 */
function EffectSwatch({ fx }: { fx: ProfileFx | null }) {
  return (
    <span aria-hidden className="relative w-12 h-9 rounded-md overflow-hidden bg-black/40 flex items-center justify-center gap-0.5">
      {fx?.overlay && <span className={`fc-fx-ov fc-fx-ov-${fx.overlay} fc-fx-still`} />}
      {fx
        ? fx.chars.slice(0, 3).map((ch, i) => (
            <span key={i} className="fc-swatch-glyph relative text-sm leading-none" style={{ color: fx.colors[i % fx.colors.length], animationDelay: `${i * 0.2}s` }}>{ch}</span>
          ))
        : <span className="text-fc-muted text-sm">∅</span>}
    </span>
  )
}

/** Recherche + catégories d'un sélecteur. */
function PickerBar({ query, setQuery, cat, setCat, groups, all, a11y }: {
  query: string; setQuery: (q: string) => void; cat: string; setCat: (c: string) => void
  groups: { id: string; label: Key }[]; all: string; a11y: string
}) {
  const t = useT()
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-fc-input border border-fc-hover max-w-sm">
        <Search size={14} className="text-fc-muted flex-shrink-0" aria-hidden />
        <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('pdeco.search')} aria-label={a11y}
          className="flex-1 bg-transparent text-sm text-fc-text outline-none min-w-0" maxLength={40} />
      </label>
      <div role="tablist" aria-label={t('pdeco.categories')} className="flex flex-wrap gap-1.5">
        {[{ id: '', label: null as Key | null }, ...groups].map(g => (
          <button key={g.id || 'all'} type="button" role="tab" aria-selected={cat === g.id} onClick={() => setCat(g.id)}
            className={`px-2.5 py-1 rounded-full text-[11px] border transition ${cat === g.id ? 'border-fc-accent bg-fc-accent/15 text-white' : 'border-fc-hover text-fc-muted hover:text-white'}`}>
            {g.label ? t(g.label) : all}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Décoration d'avatar (et ses réglages), thème et effet de la fiche profil — gratuits, avec aperçu. */
export default function ProfileCosmetics({ user, report, previewName }: Props) {
  const t = useT()
  const [decoration, setDecoration] = useState<string>(user.avatar_decoration ?? '')
  const [opts, setOpts] = useState<DecoOpts>(() => cleanDecoOpts(user.avatar_decoration_opts))
  const [primary, setPrimary] = useState<number | null>(user.profile_color_primary ?? null)
  const [accent, setAccent] = useState<number | null>(user.profile_color_accent ?? null)
  const [effect, setEffect] = useState<string>(user.profile_effect ?? '')
  const [intensity, setIntensity] = useState<number>(() => cleanIntensity(user.profile_effect_intensity))
  // Anneau global (users.avatar_ring, null = aucun) et carte de profil (users.profile_card).
  const [ring, setRing] = useState<AvatarRingData | null>(() => cleanRing(user.avatar_ring))
  const [card, setCard] = useState<ProfileCard>(() => cleanCard(user.profile_card))
  const [replay, setReplay] = useState(0)
  const [decoQuery, setDecoQuery] = useState('')
  const [decoCat, setDecoCat] = useState('')
  const [fxQuery, setFxQuery] = useState('')
  const [fxCat, setFxCat] = useState('')
  const patchOpts = (p: Partial<DecoOpts>) => setOpts(o => cleanDecoOpts({ ...o, ...p }))

  // "" et -1 = retirer (le serveur ignore les champs absents) ; {} = réglages par défaut ;
  // null = pas d'anneau global / carte par défaut.
  useDraft('cosmetics', {
    avatar_ring: cleanRing(ring),
    profile_card: cardPayload(card),
    avatar_decoration: decoration,
    avatar_decoration_opts: decoOptsPayload(opts),
    profile_color_primary: primary ?? -1,
    profile_color_accent: accent ?? -1,
    profile_effect: effect,
    profile_effect_intensity: intensity,
  }, report)

  const avatar = (size: number) => (
    <div className="rounded-full bg-fc-accent flex items-center justify-center font-bold text-white overflow-hidden" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {user.avatar
        ? <img src={mediaUrl(user.avatar)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
        : user.username.charAt(0).toUpperCase()}
    </div>
  )

  // Sections filtrées par catégorie et recherche (libellé traduit ou identifiant).
  const decoSections = useMemo(() => {
    const q = searchKey(decoQuery)
    return DECO_GROUPS.filter(g => !decoCat || g.id === decoCat)
      .map(g => ({ id: g.id, label: t(g.label), ids: g.ids.filter(id => { const d = DECO_BY_ID.get(id); return d && matches(q, t(d.label), id) }) }))
      .filter(g => g.ids.length)
  }, [decoQuery, decoCat, t])
  const fxSections = useMemo(() => {
    const q = searchKey(fxQuery)
    return FX_GROUPS.filter(g => !fxCat || g.id === fxCat)
      .map(g => ({ id: g.id, label: t(g.label), ids: g.ids.filter(id => { const f = FX_BY_ID.get(id); return f && matches(q, t(f.label), id) }) }))
      .filter(g => g.ids.length)
  }, [fxQuery, fxCat, t])

  const tile = (on: boolean) => `fc-pick fc-pick-still flex flex-col items-center gap-1.5 p-2 rounded-lg border transition ${on ? 'border-fc-accent bg-fc-accent/10' : 'border-fc-hover hover:border-fc-muted'}`
  const slider = (key: DecoNumKey, label: Key, step = 5) => {
    const [min, max] = DECO_RANGES[key]
    return (
      <label key={key} className="flex items-center gap-3 text-xs text-fc-muted">
        <span className="w-36 flex-shrink-0">{t(label, { n: opts[key] })}</span>
        <input type="range" min={min} max={max} step={step} value={opts[key]} disabled={!decoration}
          onChange={e => patchOpts({ [key]: Number(e.target.value) })} className="flex-1 accent-fc-accent" aria-label={t(label, { n: opts[key] })} />
      </label>
    )
  }

  return (
    <div className="space-y-5 border-t border-fc-hover pt-6">
      <h3 className="text-sm font-semibold text-white">{t('settings.cosmetics.title')} <span className="text-xs font-normal text-fc-muted">{t('settings.cosmetics.free')}</span></h3>

      {/* Aperçu de la fiche (carte, bannière, anneau, décoration et effet appliqués en direct) */}
      <ProfileCardPreview key={replay} card={card} primary={primary} accent={accent} banner={user.banner} name={previewName}
        avatar={
          <AvatarDecoration id={decoration} size={64} opts={opts}>
            <AvatarRing ring={ring} size={72}>
              <span className="block rounded-full border-4 border-fc-bg">{avatar(64)}</span>
            </AvatarRing>
          </AvatarDecoration>
        }>
        <ProfileEffect key={`${effect}-${intensity}`} id={effect} intensity={intensity} />
      </ProfileCardPreview>

      <Field label={t('ring.global.title')} hint={t('ring.global.hint')}>
        <AvatarRingFields value={ring} onChange={setRing} avatar={avatar} />
      </Field>

      <Field label={t('card.title')} hint={t('card.hint')}>
        <ProfileCardFields value={card} onChange={setCard} />
      </Field>

      <Field label={t('settings.cosmetics.decoration')} hint={t('pedit.deco.count', { n: DECORATIONS.length })}>
        <div className="space-y-3">
          <PickerBar query={decoQuery} setQuery={setDecoQuery} cat={decoCat} setCat={setDecoCat} groups={DECO_GROUPS} all={t('pdeco.all')} a11y={t('pdeco.searchA11y')} />
          <div className="space-y-4 max-h-[26rem] overflow-y-auto pr-1" role="radiogroup" aria-label={t('settings.cosmetics.decoration')}>
            {!decoQuery && !decoCat && (
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                <button type="button" role="radio" onClick={() => setDecoration('')} aria-checked={decoration === ''} title={t('settings.cosmetics.noneF')} className={tile(decoration === '')}>
                  <span className="p-1.5">{avatar(36)}</span>
                  <span className="text-[10px] text-fc-muted truncate max-w-full">{t('settings.cosmetics.noneF')}</span>
                </button>
              </div>
            )}
            {decoSections.map(g => (
              <div key={g.id}>
                <p className="text-[11px] font-semibold text-fc-muted mb-2">{g.label}</p>
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                  {g.ids.map(id => {
                    const label = t(DECO_BY_ID.get(id)!.label)
                    return (
                      <button key={id} type="button" role="radio" onClick={() => setDecoration(id)} aria-checked={decoration === id} title={label} className={tile(decoration === id)}>
                        <span className="p-2"><AvatarDecoration id={id} size={36}>{avatar(36)}</AvatarDecoration></span>
                        <span className="text-[10px] text-fc-muted truncate max-w-full">{label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
            {!decoSections.length && <p className="text-xs text-fc-muted">{t('pdeco.noMatch')}</p>}
          </div>
        </div>
      </Field>

      <Field label={t('pdeco.opts.title')} hint={t('pdeco.opts.hint')}>
        <div className={`space-y-2 max-w-md ${decoration ? '' : 'opacity-50 pointer-events-none'}`}>
          <div className="flex flex-wrap items-center gap-4 text-sm text-fc-text">
            <span className="flex items-center gap-2"><Toggle value={opts.animate} onChange={v => patchOpts({ animate: v })} label={t('pdeco.opts.animate')} />{t('pdeco.opts.animate')}</span>
            <span className="flex items-center gap-2"><Toggle value={opts.pulse} onChange={v => patchOpts({ pulse: v })} label={t('pdeco.opts.pulse')} />{t('pdeco.opts.pulse')}</span>
          </div>
          <div role="radiogroup" aria-label={t('pdeco.opts.direction')} className="flex items-center gap-2 text-xs text-fc-muted">
            <span className="w-36 flex-shrink-0">{t('pdeco.opts.direction')}</span>
            {(['cw', 'ccw'] as const).map(d => (
              <button key={d} type="button" role="radio" aria-checked={opts.direction === d} onClick={() => patchOpts({ direction: d })}
                className={`px-2.5 py-1 rounded-md border ${opts.direction === d ? 'border-fc-accent bg-fc-accent/10 text-white' : 'border-fc-hover hover:border-fc-muted'}`}>
                {t(d === 'cw' ? 'pdeco.opts.cw' : 'pdeco.opts.ccw')}
              </button>
            ))}
          </div>
          {slider('speed', 'pdeco.opts.speed')}
          {slider('scale', 'pdeco.opts.scale', 1)}
          {slider('brightness', 'pdeco.opts.brightness')}
          {slider('saturation', 'pdeco.opts.saturation')}
          {slider('glow', 'pdeco.opts.glow')}
          {slider('opacity', 'pdeco.opts.opacity')}
          {slider('hue', 'pdeco.opts.hue', 1)}
          <div className="flex items-center gap-3 text-xs text-fc-muted">
            <span className="w-36 flex-shrink-0">{t('pdeco.opts.tint')}</span>
            <Toggle value={opts.tint != null} onChange={v => patchOpts({ tint: v ? 0xff5c8a : null })} label={t('pdeco.opts.tintOn')} />
            {opts.tint != null && (
              <input type="color" value={hexColor(opts.tint)} onChange={e => patchOpts({ tint: toInt(e.target.value) })}
                className="w-8 h-8 rounded cursor-pointer bg-transparent" aria-label={t('pdeco.opts.tint')} />
            )}
          </div>
          {!isDefaultDecoOpts(opts) && (
            <button type="button" onClick={() => setOpts({ ...DECO_OPTS_DEFAULT })} className="text-xs text-fc-muted hover:text-white underline">
              {t('pdeco.opts.reset')}
            </button>
          )}
        </div>
      </Field>

      <Field label={t('settings.cosmetics.theme')} hint={t('settings.cosmetics.themeHint')}>
        <div className="flex flex-wrap items-center gap-4">
          {([[t('settings.cosmetics.primary'), primary, setPrimary], [t('settings.cosmetics.accent'), accent, setAccent]] as const).map(([label, value, set]) => (
            <label key={label} className="flex items-center gap-2 text-sm text-fc-text">
              <input
                type="color"
                value={hexColor(value ?? 0x5865f2)}
                onChange={e => set(toInt(e.target.value))}
                className="w-9 h-9 rounded cursor-pointer bg-transparent"
              />
              {label}
            </label>
          ))}
          {(primary != null || accent != null) && (
            <button type="button" onClick={() => { setPrimary(null); setAccent(null) }} className="text-xs text-fc-muted hover:text-white underline">
              {t('settings.cosmetics.defaultTheme')}
            </button>
          )}
        </div>
      </Field>

      <Field label={t('settings.cosmetics.effect')} hint={`${t('settings.cosmetics.effectHint')} ${t('pfx.count', { n: PROFILE_EFFECTS.length })}`}>
        <div className="space-y-3">
          <PickerBar query={fxQuery} setQuery={setFxQuery} cat={fxCat} setCat={setFxCat} groups={FX_GROUPS} all={t('pfx.all')} a11y={t('pfx.searchA11y')} />
          <div role="radiogroup" aria-label={t('settings.cosmetics.effect')} className="space-y-4 max-h-[22rem] overflow-y-auto pr-1">
            {!fxQuery && !fxCat && (
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                <button type="button" role="radio" aria-checked={effect === ''} title={t('pedit.fx.none')} onClick={() => setEffect('')} className={tile(effect === '')}>
                  <EffectSwatch fx={null} />
                  <span className="text-[10px] text-fc-muted truncate max-w-full">{t('pedit.fx.none')}</span>
                </button>
              </div>
            )}
            {fxSections.map(g => (
              <div key={g.id}>
                <p className="text-[11px] font-semibold text-fc-muted mb-2">{g.label}</p>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {g.ids.map(id => {
                    const fx = FX_BY_ID.get(id)!
                    const label = t(fx.label)
                    return (
                      <button key={id} type="button" role="radio" aria-checked={effect === id} title={label}
                        onClick={() => { setEffect(id); setReplay(n => n + 1) }} className={tile(effect === id)}>
                        <EffectSwatch fx={fx} />
                        <span className="text-[10px] text-fc-muted truncate max-w-full">{label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
            {!fxSections.length && <p className="text-xs text-fc-muted">{t('pdeco.noMatch')}</p>}
          </div>
          <label className="flex items-center gap-3 text-xs text-fc-muted max-w-md">
            <span className="w-36 flex-shrink-0">{t('pfx.intensity', { n: intensity })}</span>
            <input type="range" min={FX_INTENSITY[0]} max={FX_INTENSITY[1]} step={5} value={intensity} disabled={!effect}
              onChange={e => setIntensity(cleanIntensity(Number(e.target.value)))} onPointerUp={() => setReplay(n => n + 1)}
              className="flex-1 accent-fc-accent" aria-label={t('pfx.intensity', { n: intensity })} />
          </label>
          {effect && (
            <button type="button" onClick={() => setReplay(n => n + 1)} className="text-xs text-fc-muted hover:text-white underline">
              {t('settings.cosmetics.replay')}
            </button>
          )}
        </div>
      </Field>
    </div>
  )
}
