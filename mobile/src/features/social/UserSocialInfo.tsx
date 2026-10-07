// Fiche profil (lot « Profil et social ») : statut riche, « en appel », anniversaire
// (jour et mois, jamais l'année) et badges calculés par le serveur.
import { useQuery } from '@tanstack/react-query'
import { Text, View } from 'react-native'
import { socialApi, socialKeys } from '@/api/social'
import { Section } from '@/components/ui'
import { useT, type Key } from '@/i18n'
import { useActivityOf } from '@/stores/presence'
import { colors, font, radius, spacing } from '@/theme'
import { daysUntil } from './birthday'
import { richText, type RichActivity } from './rich'

const BADGE_ICONS: Record<string, string> = {
  age_1m: '🌱', age_6m: '🌿', age_1y: '🌳', age_2y: '🏛️', age_3y: '👑',
  msg_100: '💬', msg_1k: '🗣️', msg_10k: '📣', msg_100k: '🏆',
  first_voice: '🎙️', events_1: '📅', events_10: '🎟️',
  friends_1: '🤝', friends_25: '🫂', founder: '🏰',
}

export function UserSocialInfo({ userId, activity }: { userId: string; activity?: RichActivity }) {
  const t = useT()
  const live = useActivityOf(userId)
  const q = useQuery({ queryKey: socialKeys.user(userId), queryFn: () => socialApi.user(userId), staleTime: 60_000 })
  if (!q.data) return null
  const rich = richText({ ...(live ?? activity), in_call: live?.in_call ?? q.data.in_call }, t)
  const badges = q.data.badges.filter((b) => b in BADGE_ICONS)
  const bday = q.data.birthday
  if (!rich && !bday && badges.length === 0) return null
  return (
    <Section>
      <View style={{ padding: spacing.md, gap: spacing.sm }}>
        {rich ? <Text style={{ color: colors.text }}>{rich}</Text> : null}
        {bday ? (
          <Text style={{ color: colors.text }}>
            🎂 {daysUntil(bday) === 0 ? t('soc.bday.today') : `${bday.day}/${bday.month}`}
          </Text>
        ) : null}
        {badges.length ? (
          <View style={{ gap: 4 }}>
            <Text style={{ color: colors.textMuted, fontSize: font.xs, fontWeight: '700' }}>{t('soc.badges.title').toUpperCase()}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {badges.map((b) => (
                <View
                  key={b}
                  accessible
                  accessibilityLabel={t(`soc.badge.${b}` as Key)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.full, backgroundColor: colors.bgElevated }}
                >
                  <Text>{BADGE_ICONS[b]}</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: font.xs }}>{t(`soc.badge.${b}` as Key)}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </Section>
  )
}
