import { useQueries, useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useMemo, useState } from 'react'
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { messagesApi } from '@/api/messages'
import { serversApi } from '@/api/servers'
import { EmptyState, ErrorState, Loading, TextField } from '@/components/ui'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { qk } from '@/lib/queryClient'
import { colors, font, spacing } from '@/theme'

/** Choix du salon de destination d'un transfert (comme ForwardModal : salons textuels de mes serveurs). */
export default function ForwardScreen() {
  const t = useT()
  const { valid, ids } = useRouteParams(['messageId'] as const)
  const [search, setSearch] = useState('')
  const [sending, setSending] = useState(false)
  const servers = useQuery({ queryKey: qk.servers, queryFn: serversApi.list })
  const channels = useQueries({
    queries: (servers.data ?? []).map((s) => ({ queryKey: qk.channels(s.id), queryFn: () => serversApi.channels(s.id) })),
  })
  const targets = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (servers.data ?? []).flatMap((s, i) =>
      (channels[i]?.data ?? [])
        .filter((c) => c.type === 'text' && (!q || c.name.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)))
        .map((c) => ({ id: c.id, name: c.name, serverName: s.name })),
    )
  }, [servers.data, channels, search])

  if (!valid) return <ErrorState message={t('social.message.invalid')} />
  if (servers.isLoading) return <Loading />
  if (servers.error) return <ErrorState message={errorMessage(servers.error)} onRetry={() => void servers.refetch()} />

  const forward = (target: { id: string; name: string }) =>
    Alert.alert(t('social.forward.confirm'), t('social.forward.to', { name: target.name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('chat.forward'),
        onPress: () => {
          setSending(true)
          messagesApi
            .forward(ids.messageId, target.id)
            .then(() => {
              Alert.alert(t('social.forward.done'))
              router.back()
            })
            .catch((e) => Alert.alert(t('social.forward.failed'), errorMessage(e)))
            .finally(() => setSending(false))
        },
      },
    ])

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ padding: spacing.md }}>
        <TextField placeholder={t('social.forward.placeholder')} value={search} onChangeText={setSearch} accessibilityLabel={t('social.forward.searchLabel')} autoCorrect={false} />
      </View>
      <FlatList
        data={targets}
        keyExtractor={(c) => c.id}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={channels.some((c) => c.isLoading) ? <Loading /> : <EmptyState icon="search" title={t('channels.none')} />}
        renderItem={({ item }) => (
          <Pressable
            disabled={sending}
            onPress={() => forward(item)}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.bgHover }]}
            accessibilityRole="button"
            accessibilityLabel={t('social.forward.itemLabel', { name: item.name, server: item.serverName })}
          >
            <Ionicons name="chatbox-outline" size={18} color={colors.textMuted} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>
                # {item.name}
              </Text>
              <Text style={styles.server} numberOfLines={1}>
                {item.serverName}
              </Text>
            </View>
          </Pressable>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  name: { color: colors.text, fontSize: font.md, fontWeight: '600' },
  server: { color: colors.textMuted, fontSize: font.xs },
})
