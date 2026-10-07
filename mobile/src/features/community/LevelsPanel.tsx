import { useQuery } from '@tanstack/react-query'
import { StyleSheet, Text, View } from 'react-native'
import { communityApi, type LevelMember } from '@/api/community'
import { Avatar } from '@/components/Avatar'
import { Section, T } from '@/components/ui'
import { useT } from '@/i18n'
import { useAuth } from '@/stores/auth'
import { colors, font, radius, spacing } from '@/theme'
import { levelProgress } from './format'

function Bar({ m, height = 6, fill = '#facc15' }: { m: LevelMember; height?: number; fill?: string }) {
  const pct = Math.round(levelProgress(m.xp, m.level_xp, m.next_level_xp) * 100)
  return (
    <View style={{ height, borderRadius: height, backgroundColor: 'rgba(0,0,0,0.3)', overflow: 'hidden' }}
      accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}>
      <View style={{ width: `${pct}%`, height: '100%', backgroundColor: fill }} />
    </View>
  )
}

/** Niveaux natifs : ma carte (dessinée ici) et le classement. Rien si désactivés. */
export function LevelsPanel({ serverId }: { serverId: string }) {
  const t = useT()
  const meId = useAuth((s) => s.user?.id)
  const settings = useQuery({ queryKey: ['community', serverId, 'levels'], queryFn: () => communityApi.levels.get(serverId) })
  const enabled = !!settings.data?.enabled
  const board = useQuery({ queryKey: ['levels_board', serverId], queryFn: () => communityApi.leaderboard(serverId), enabled })
  const mine = useQuery({ queryKey: ['levels_board', serverId, 'me'], queryFn: () => communityApi.levelCard(serverId, meId ?? ''), enabled: enabled && !!meId })
  if (!enabled) return null
  const me = mine.data
  return (
    <Section title={t('community.levels.board')} footer={t('community.levels.privacy')}>
      {me ? (
        <View style={styles.card} accessibilityLabel={t('community.levels.cardLine', { n: me.level, rank: me.rank || '—' })}>
          <Avatar uri={me.avatar} name={me.username} size={56} />
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Text style={styles.cardTitle}>{me.username}</Text>
            <Text style={styles.cardText}>{t('community.levels.cardLine', { n: me.level, rank: me.rank || '—' })}</Text>
            <Bar m={me} height={10} fill="#fff" />
            <Text style={styles.cardText}>{t('community.levels.xp', { xp: me.xp, next: me.next_level_xp })}</Text>
          </View>
        </View>
      ) : null}
      {(board.data ?? []).map((m) => (
        <View key={m.user_id} style={[styles.row, m.user_id === meId && { backgroundColor: colors.bgHover }]}>
          <T variant="muted" style={{ width: 36 }}>#{m.rank}</T>
          <Avatar uri={m.avatar} name={m.username} size={32} />
          <View style={{ flex: 1, gap: 4 }}>
            <T numberOfLines={1}>{m.username}</T>
            <Bar m={m} />
          </View>
          <T variant="label">{t('community.levels.level', { n: m.level })}</T>
        </View>
      ))}
    </Section>
  )
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: '#b7791f', margin: spacing.sm },
  cardTitle: { color: '#fff', fontSize: font.lg, fontWeight: '700' },
  cardText: { color: 'rgba(255,255,255,0.9)', fontSize: font.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
})
