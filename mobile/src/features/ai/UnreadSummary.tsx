// Bandeau « Tu as raté N messages — Résumer » : résumé extractif des non-lus calculé sur
// le téléphone (lib/ai/summary.ts), sans modèle ni réseau. Appui sur un extrait = saut au message.
import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useT } from '@/i18n'
import { summarize } from '@/lib/ai/summary'
import { mentionsUser } from '@/lib/markdown'
import type { ChatMessage } from '@/types/models'
import { colors, font, radius, spacing } from '@/theme'
import { useAiSettings } from './actions'

const MIN_UNREAD = 5

interface Props {
  /** Non-lus, du plus ancien au plus récent. */
  unread: ChatMessage[]
  me: { id: string; username: string } | null
  onJump: (id: string) => void
}

export default function UnreadSummary({ unread, me, onJump }: Props) {
  const t = useT()
  const enabled = useAiSettings((s) => s.summary)
  const [open, setOpen] = useState(false)
  const [closed, setClosed] = useState(false)
  const summary = useMemo(
    () =>
      open
        ? summarize(
            unread.map((m) => ({
              id: m.id,
              author: m.authorName,
              text: m.e2e === 'locked' ? '' : (m.content ?? ''),
              reactions: m.reactions.reduce((n, r) => n + r.count, 0),
              mentionsMe: !!me && mentionsUser(m.content, me.id, me.username),
              attachments: m.attachments.length,
            })),
          )
        : null,
    [open, unread, me],
  )
  if (!enabled || closed || unread.length < MIN_UNREAD) return null

  return (
    <View style={styles.box}>
      <View style={styles.head}>
        <Ionicons name="sparkles-outline" size={16} color={colors.primary} />
        <Text style={styles.title} numberOfLines={1}>{t('ai.summary.missed', { n: unread.length })}</Text>
        {!open ? (
          <Pressable onPress={() => setOpen(true)} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.action}>{t('ai.summary')}</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={() => setClosed(true)} accessibilityRole="button" accessibilityLabel={t('common.close')} hitSlop={8}>
          <Ionicons name="close" size={18} color={colors.textMuted} />
        </Pressable>
      </View>
      {summary ? (
        <View style={{ gap: spacing.xs, marginTop: spacing.xs }}>
          <Text style={styles.meta}>
            {t('ai.summary.from', { names: summary.authors.slice(0, 4).map((a) => `${a.name} (${a.count})`).join(', ') })}
            {summary.keywords.length ? ` · ${t('ai.summary.topics', { words: summary.keywords.join(', ') })}` : ''}
          </Text>
          {summary.highlights.length ? (
            summary.highlights.map((h) => (
              <Pressable key={h.id} onPress={() => onJump(h.id)} accessibilityRole="button">
                <Text style={styles.line} numberOfLines={3}>
                  <Text style={{ fontWeight: '700' }}>{h.author}</Text> — {h.text}
                </Text>
              </Pressable>
            ))
          ) : (
            <Text style={styles.meta}>{t('ai.summary.empty')}</Text>
          )}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  box: { margin: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.bgAlt, borderColor: colors.border, borderWidth: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1, color: colors.text, fontSize: font.sm },
  action: { color: colors.primary, fontSize: font.sm, fontWeight: '600' },
  meta: { color: colors.textMuted, fontSize: font.xs },
  line: { color: colors.text, fontSize: font.sm },
})
