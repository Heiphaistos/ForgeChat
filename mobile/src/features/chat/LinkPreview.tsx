import { Ionicons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { Pressable, StyleSheet, Text } from 'react-native'
import { messagesApi } from '@/api/messages'
import { openExternalUrl } from '@/lib/links'
import { colors, font, radius, spacing } from '@/theme'

/**
 * Aperçu d'un lien (GET /og), comme LinkPreview.tsx côté web. Sans image : elle viendrait d'un
 * hôte quelconque (pixel espion, fuite de l'IP) — même règle que lib/links.resolveMediaUrl.
 */
export function LinkPreview({ url }: { url: string }) {
  const { data } = useQuery({
    queryKey: ['og', url],
    queryFn: ({ signal }) => messagesApi.linkPreview(url, signal),
    staleTime: 3_600_000,
    gcTime: 3_600_000,
    retry: false,
  })
  if (!data) return null
  const host = (() => {
    try {
      return new URL(data.url).host
    } catch {
      return url
    }
  })()
  return (
    <Pressable
      onPress={() => void openExternalUrl(url)}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
      accessibilityRole="link"
      accessibilityLabel={`Aperçu du lien : ${data.title ?? data.siteName ?? host}`}
    >
      {data.siteName ? (
        <Text style={styles.site} numberOfLines={1}>
          {data.siteName}
        </Text>
      ) : null}
      {data.title ? (
        <Text style={styles.title} numberOfLines={2}>
          {data.title}
        </Text>
      ) : null}
      {data.description ? (
        <Text style={styles.desc} numberOfLines={3}>
          {data.description}
        </Text>
      ) : null}
      <Text style={styles.host} numberOfLines={1}>
        <Ionicons name="open-outline" size={11} color={colors.link} /> {host}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    marginTop: 6,
    maxWidth: 420,
    backgroundColor: colors.bgAlt,
    borderRadius: radius.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    padding: spacing.sm,
    gap: 2,
  },
  site: { color: colors.textMuted, fontSize: font.xs, textTransform: 'uppercase' },
  title: { color: colors.text, fontSize: font.sm, fontWeight: '700' },
  desc: { color: colors.textMuted, fontSize: font.xs },
  host: { color: colors.link, fontSize: font.xs, marginTop: 2 },
})
