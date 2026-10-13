import { Switch, Text, View } from 'react-native'
import { Avatar } from '@/components/Avatar'
import { AvatarRing } from '@/components/AvatarRing'
import { useT, type Key } from '@/i18n'
import { colors, font, spacing } from '@/theme'
import { Chip, Stepper, kit } from './editorKit'
import { ProfileCardFrame } from './ProfileCardView'
import {
  BANNER_FX, CARD_DEFAULT, CARD_LAYOUTS, CARD_PATTERNS, CARD_RANGES, CARD_STYLES, NAME_ALIGNS, cardHeader, cardOnColor, cleanCard,
  type ProfileCard,
} from './profileCard'

/** Éditeur de la carte de profil (profile_card) avec aperçu aux couleurs du thème. */
export function ProfileCardEditor({
  value, onChange, primary, accent, avatar, name, ring,
}: {
  value: ProfileCard
  onChange: (v: ProfileCard) => void
  primary: number | null
  accent: number | null
  avatar: string | null | undefined
  name: string
  ring: unknown
}) {
  const t = useT()
  const set = (patch: Partial<ProfileCard>) => onChange(cleanCard({ ...value, ...patch }))
  const head = cardHeader(value)
  const onColor = cardOnColor(value.card, primary != null || accent != null)
  const list = <T extends string>(label: Key, items: readonly T[], current: T, prefix: string, key: keyof ProfileCard) => (
    <>
      <Text style={kit.label}>{t(label)}</Text>
      <View style={kit.wrap}>
        {items.map((x) => <Chip key={x} label={t(`${prefix}.${x}` as Key)} selected={current === x} onPress={() => set({ [key]: x })} />)}
      </View>
    </>
  )
  const toggle = (label: Key, on: boolean, key: 'show_badges' | 'show_links') => (
    <View style={kit.row}>
      <Text style={kit.optLabel}>{t(label)}</Text>
      <Switch value={on} onValueChange={(v) => set({ [key]: v })} accessibilityLabel={t(label)} />
    </View>
  )
  const preview = Math.round(head.avatar * 0.6)

  return (
    <View style={{ gap: spacing.md }}>
      <Text style={kit.title}>{t('pcard.title')}</Text>
      <Text style={kit.hint}>{t('pcard.hint')}</Text>
      <View accessible accessibilityLabel={t('pcard.preview')}>
        <ProfileCardFrame card={value} primary={primary} accent={accent} style={{ padding: spacing.lg, minHeight: 110 }}>
          <View style={{ flexDirection: head.row ? 'row' : 'column', alignItems: head.row ? 'center' : head.avatarCenter ? 'center' : 'flex-start', gap: spacing.md }}>
            <AvatarRing ring={ring} size={preview}>
              <Avatar uri={avatar ?? null} name={name} size={preview} />
            </AvatarRing>
            <Text style={{ color: onColor ? '#fff' : colors.text, fontSize: font.lg, fontWeight: '700', alignSelf: head.row ? 'auto' : 'stretch', textAlign: head.textCenter ? 'center' : 'left' }}>{name}</Text>
          </View>
        </ProfileCardFrame>
      </View>
      {list('pcard.layout', CARD_LAYOUTS, value.layout, 'pcard.layout', 'layout')}
      {list('pcard.card', CARD_STYLES, value.card, 'pcard.card', 'card')}
      {value.card === 'gradient' ? <Stepper label={t('pcard.angle', { n: value.angle })} value={value.angle} min={CARD_RANGES.angle[0]} max={CARD_RANGES.angle[1]} step={45} onChange={(n) => set({ angle: n })} /> : null}
      {list('pcard.pattern', CARD_PATTERNS, value.pattern, 'pcard.pattern', 'pattern')}
      <Stepper label={t('pcard.radius', { n: value.radius })} value={value.radius} min={CARD_RANGES.radius[0]} max={CARD_RANGES.radius[1]} step={2} onChange={(n) => set({ radius: n })} />
      {list('pcard.bannerFx', BANNER_FX, value.banner_fx, 'pcard.fx', 'banner_fx')}
      <Stepper label={t('pcard.bannerY', { n: value.banner_y })} value={value.banner_y} min={CARD_RANGES.banner_y[0]} max={CARD_RANGES.banner_y[1]} step={10} onChange={(n) => set({ banner_y: n })} />
      {list('pcard.nameAlign', NAME_ALIGNS, value.name_align, 'pcard.align', 'name_align')}
      {toggle('pcard.showBadges', value.show_badges, 'show_badges')}
      {toggle('pcard.showLinks', value.show_links, 'show_links')}
      <Chip label={t('pcard.reset')} selected={false} onPress={() => onChange({ ...CARD_DEFAULT })} />
    </View>
  )
}
