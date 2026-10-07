import { Ionicons } from '@expo/vector-icons'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { pollsApi } from '@/api/polls'
import { useT } from '@/i18n'
import { formatShort } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { qk, queryClient } from '@/lib/queryClient'
import { colors, font, radius, spacing } from '@/theme'
import { isPollClosed, nextVote, pollPercent } from './polls'

/** Sondage d'un message de salon (comme PollDisplay) ; rafraîchi par POLL_VOTE / POLL_CLOSED. */
export function PollCard({ serverId, channelId, pollId, myId }: { serverId: string; channelId: string; pollId: string; myId: string }) {
  const t = useT()
  const q = useQuery({ queryKey: qk.poll(pollId), queryFn: () => pollsApi.get(serverId, channelId, pollId), retry: false })
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.poll(pollId) })
  const vote = useMutation({
    mutationFn: (optionIds: string[]) => pollsApi.vote(serverId, channelId, pollId, optionIds),
    onSuccess: refresh,
    onError: (e) => Alert.alert(t('panel.poll.voteFailed'), errorMessage(e)),
  })
  const close = useMutation({
    mutationFn: () => pollsApi.close(serverId, channelId, pollId),
    onSuccess: refresh,
    onError: (e) => Alert.alert(t('common.actionFailed'), errorMessage(e)),
  })

  if (q.isLoading) return <ActivityIndicator color={colors.primary} style={styles.loading} />
  const poll = q.data
  if (!poll) return null
  const closed = isPollClosed(poll)
  const hasVoted = poll.options.some((o) => o.voted)
  const showResults = hasVoted || closed
  const votes = (n: number) => t(n !== 1 ? 'panel.poll.votesMany' : 'panel.poll.votes', { n })

  return (
    <View style={styles.card} accessibilityLabel={t('panel.poll.a11y', { question: poll.question })}>
      <View style={styles.head}>
        <Ionicons name="stats-chart" size={14} color={colors.primary} />
        <Text style={styles.question}>{poll.question}</Text>
        {!closed && poll.creatorId === myId ? (
          <Pressable onPress={() => close.mutate()} disabled={close.isPending} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('panel.poll.end')}>
            <Ionicons name="close" size={16} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.meta} accessibilityLiveRegion="polite">
        {votes(poll.totalVotes)}
        {poll.multipleChoice ? t('panel.poll.multipleSuffix') : ''}
        {closed ? t('panel.poll.closedSuffix') : poll.endsAt ? t('panel.poll.endsSuffix', { date: formatShort(poll.endsAt) }) : ''}
      </Text>
      {poll.options.map((o) => {
        const percent = pollPercent(o.votes, poll.totalVotes)
        return (
          <Pressable
            key={o.id}
            disabled={closed || vote.isPending}
            onPress={() => vote.mutate(nextVote(poll, o.id))}
            style={({ pressed }) => [styles.option, o.voted && styles.optionMine, pressed && { opacity: 0.7 }]}
            accessibilityRole={closed ? undefined : poll.multipleChoice ? 'checkbox' : 'radio'}
            accessibilityState={{ checked: o.voted, disabled: closed }}
            accessibilityLabel={showResults ? t('panel.poll.optionResult', { text: o.text, percent, votes: votes(o.votes) }) : o.text}
          >
            {showResults ? <View style={[styles.bar, { width: `${percent}%` }]} /> : null}
            <Ionicons name={o.voted ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={o.voted ? colors.primary : colors.textMuted} />
            <Text style={[styles.optionText, o.voted && { color: colors.text, fontWeight: '700' }]}>{o.text}</Text>
            {showResults ? <Text style={styles.percent}>{percent} %</Text> : null}
          </Pressable>
        )
      })}
      {hasVoted && !closed ? (
        <Text style={styles.meta}>{t(poll.multipleChoice ? 'panel.poll.hintMultiple' : 'panel.poll.hintSingle')}</Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  loading: { alignSelf: 'flex-start', margin: spacing.sm },
  card: { marginTop: spacing.xs, padding: spacing.md, gap: spacing.xs, backgroundColor: colors.bgAlt, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  question: { flex: 1, color: colors.text, fontWeight: '700', fontSize: font.md },
  meta: { color: colors.textMuted, fontSize: font.xs },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 40,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.bgElevated,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  optionMine: { borderColor: colors.primary },
  bar: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: colors.primary + '40' },
  optionText: { flex: 1, color: colors.textSecondary, fontSize: font.sm },
  percent: { color: colors.textMuted, fontSize: font.xs, fontWeight: '700' },
})
