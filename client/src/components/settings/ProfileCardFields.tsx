import type { CSSProperties, ReactNode } from 'react'
import { Toggle } from './shared'
import { Chips, RangeRow } from './lookControls'
import { useT, type Key } from '../../i18n'
import {
  BANNER_FX, CARD_DEFAULT, CARD_LAYOUTS, CARD_PATTERNS, CARD_RADIUS_MAX, CARD_STYLES, NAME_ALIGNS,
  cardLook, cleanCard, type ProfileCard,
} from '../../lib/profileCard'
import { profileThemeBackground } from '../../lib/profileDecor'
import ProfileBanner from '../ui/ProfileBanner'
import { CardPatternLayer } from '../ui/ProfileCardParts'

/**
 * Réglages de la carte de profil (users.profile_card) : mise en page, style, motif, cadrage et
 * effet de bannière, arrondi, angle, badges, liens, alignement du nom. Bornes : lib/profileCard.ts.
 */
export default function ProfileCardFields({ value, onChange }: { value: ProfileCard; onChange: (c: ProfileCard) => void }) {
  const t = useT()
  const patch = (p: Partial<ProfileCard>) => onChange(cleanCard({ ...value, ...p }))
  const toggle = (key: 'show_badges' | 'show_links', label: Key) => (
    <span className="flex items-center gap-2 text-sm text-fc-text">
      <Toggle value={value[key]} onChange={v => patch({ [key]: v })} label={t(label)} />{t(label)}
    </span>
  )
  return (
    <div className="space-y-2 max-w-md">
      <Chips label={t('card.layout')} value={value.layout} options={CARD_LAYOUTS} labelOf={v => t(`card.layout.${v}` as Key)} onChange={layout => patch({ layout })} />
      <Chips label={t('card.style')} value={value.card} options={CARD_STYLES} labelOf={v => t(`card.style.${v}` as Key)} onChange={card => patch({ card })} />
      <Chips label={t('card.pattern')} value={value.pattern} options={CARD_PATTERNS} labelOf={v => t(`themes.pattern.${v}` as Key)} onChange={pattern => patch({ pattern })} />
      <Chips label={t('card.bannerFx')} value={value.banner_fx} options={BANNER_FX} labelOf={v => t(`card.bannerFx.${v}` as Key)} onChange={banner_fx => patch({ banner_fx })} />
      <RangeRow label={t('card.bannerY', { n: value.banner_y })} value={value.banner_y} min={0} max={100} onChange={banner_y => patch({ banner_y })} />
      <p className="text-[11px] text-fc-muted -mt-1">{t('card.bannerYHint')}</p>
      <RangeRow label={t('card.radius', { n: value.radius })} value={value.radius} min={0} max={CARD_RADIUS_MAX} onChange={radius => patch({ radius })} />
      <RangeRow label={t('card.angle', { n: value.angle })} value={value.angle} min={0} max={360} step={5}
        disabled={value.card === 'solid' || value.card === 'outline'} onChange={angle => patch({ angle })} />
      <Chips label={t('card.nameAlign')} value={value.name_align} options={NAME_ALIGNS} labelOf={v => t(`card.nameAlign.${v}` as Key)} onChange={name_align => patch({ name_align })} />
      <div className="flex flex-wrap gap-4 pt-1">
        {toggle('show_badges', 'card.showBadges')}
        {toggle('show_links', 'card.showLinks')}
      </div>
      <button type="button" onClick={() => onChange({ ...CARD_DEFAULT })} className="text-xs text-fc-muted hover:text-white underline">
        {t('card.reset')}
      </button>
    </div>
  )
}

/** Aperçu en direct de la fiche : carte, bannière (cadrage, effet), avatar et son habillage. */
export function ProfileCardPreview({ card, primary, accent, banner, name, avatar, children }: {
  card: ProfileCard
  primary: number | null
  accent: number | null
  banner?: string | null
  name: string
  /** Avatar habillé (décoration, anneau) de la fiche. */
  avatar: ReactNode
  /** Effet de profil (calque). */
  children?: ReactNode
}) {
  const t = useT()
  const look = cardLook(card, primary, accent)
  const center = look.nameCenter ? ' text-center justify-center' : ''
  return (
    <div className="relative overflow-hidden border border-fc-hover bg-fc-bg max-w-sm" style={look.style as CSSProperties} aria-live="polite">
      <CardPatternLayer pattern={look.pattern} />
      {children}
      <div className="relative" aria-hidden>
        <ProfileBanner src={banner} minHeight={64} maxHeight={150} focus={look.banner.focus} className={look.banner.className}
          cover={look.banner.height ? { height: Math.round(look.banner.height * 0.8) } : undefined}
          emptyClassName="h-20" emptyStyle={{ background: profileThemeBackground(primary, accent) ?? 'linear-gradient(135deg, #5865f2 0%, #9b59b6 100%)' }} />
        <div className={`absolute -bottom-10 ${look.centered ? 'left-1/2 -translate-x-1/2' : 'left-4'}`}>{avatar}</div>
      </div>
      <div className="relative pt-12 px-4 pb-4 space-y-2">
        <div className={look.nameCenter ? 'text-center' : ''}>
          <p className="text-white font-semibold truncate">{name}</p>
          <p className="text-xs text-fc-muted">{t('settings.cosmetics.preview')}</p>
        </div>
        {card.show_badges && (
          <div className={`flex gap-1${center}`} role="img" aria-label={t('card.preview.badges')}>
            {['🌱', '💬', '🤝'].map(b => <span key={b} aria-hidden className="w-6 h-6 flex items-center justify-center rounded-md bg-fc-channel text-sm">{b}</span>)}
          </div>
        )}
        {card.show_links && (
          <div className={`flex gap-1${center}`}>
            <span className="px-2 py-0.5 rounded bg-fc-channel text-[11px] text-fc-text">{t('card.preview.links')}</span>
          </div>
        )}
      </div>
    </div>
  )
}
