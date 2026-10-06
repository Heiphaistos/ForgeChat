import { useQuery } from '@tanstack/react-query'
import { FlatList, StyleSheet, Text, View } from 'react-native'
import { messagesApi } from '@/api/messages'
import { MessageText } from '@/components/MessageText'
import { EmptyState, ErrorState, Loading } from '@/components/ui'
import { formatShort } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { useAuth } from '@/stores/auth'
import { colors, font, radius, spacing } from '@/theme'

/** Versions précédentes d'un message modifié (comme EditHistoryModal), de la plus récente à la plus ancienne. */
export default function EditsScreen() {
  const { valid, ids } = useRouteParams(['messageId'] as const)
  const myName = useAuth((s) => s.user?.username ?? '')
  const edits = useQuery({ queryKey: ['edits', ids.messageId], queryFn: () => messagesApi.edits(ids.messageId), enabled: valid })
  if (!valid) return <ErrorState message="Message invalide." />
  if (edits.isLoading) return <Loading />
  if (edits.error) return <ErrorState message={errorMessage(edits.error)} onRetry={() => void edits.refetch()} />
  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, flexGrow: 1 }}
      data={edits.data ?? []}
      keyExtractor={(e, i) => `${e.editedAt}-${i}`}
      ListEmptyComponent={<EmptyState icon="time-outline" title="Aucune version précédente" />}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <Text style={styles.date}>Avant la modification du {formatShort(item.editedAt)}</Text>
          {item.content ? <MessageText content={item.content} myName={myName} /> : <Text style={styles.empty}>Sans texte</Text>}
        </View>
      )}
    />
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.bgAlt, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  date: { color: colors.textMuted, fontSize: font.xs, fontWeight: '600' },
  empty: { color: colors.textMuted, fontStyle: 'italic' },
})
