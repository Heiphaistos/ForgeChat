import { Ionicons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text } from 'react-native'
import { messagesApi } from '@/api/messages'
import { settingsApi, settingsKey } from '@/api/settings'
import { apiBase } from '@/config/env'
import { ensureAccessToken } from '@/lib/http'
import { previewAllowed } from '@/e2e/channelText'
import type { LinkPreviewData } from './messageExtras'
import { useT } from '@/i18n'
import { openExternalUrl } from '@/lib/links'
import { colors, font, radius, spacing } from '@/theme'

/**
 * Image d'aperçu, toujours chargée via GET /og/image (le serveur la récupère : le site du lien ne
 * voit jamais l'IP du lecteur, même si l'adresse vient d'un expéditeur malveillant). Cette route
 * demande le jeton d'accès : il est passé en en-tête. Échec ou attente : pas d'image.
 */
function PreviewImage({ src }: { src: string }) {
  const [token, setToken] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    ensureAccessToken().then((tk) => live && setToken(tk), () => live && setFailed(true))
    return () => {
      live = false
    }
  }, [])
  if (!token || failed) return null
  return (
    <Image
      source={{ uri: `${apiBase()}/og/image?url=${encodeURIComponent(src)}`, headers: { Authorization: `Bearer ${token}` }, cacheKey: src }}
      style={styles.image}
      contentFit="cover"
      accessible={false}
      onError={() => setFailed(true)}
    />
  )
}

/**
 * Aperçu d'un lien (GET /og), comme LinkPreview.tsx côté web ; coupé par le réglage « aperçus de
 * liens » du compte. `given` : aperçu déjà connu (message chiffré : calculé par l'expéditeur),
 * aucun appel à /og pour le lire.
 */
export function LinkPreview({ url, given }: { url: string; given?: LinkPreviewData | null }) {
  const t = useT()
  const settings = useQuery({ queryKey: settingsKey, queryFn: settingsApi.get, staleTime: 300_000 })
  const enabled = settings.data?.link_preview === true
  const query = useQuery({
    queryKey: ['og', url],
    queryFn: ({ signal }) => messagesApi.linkPreview(url, signal),
    staleTime: 3_600_000,
    gcTime: 3_600_000,
    retry: false,
    enabled: enabled && given === undefined && previewAllowed(url),
  })
  const data = given === undefined ? query.data : given
  if (!data || !enabled) return null
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
      accessibilityLabel={t('panel.link.preview', { title: data.title ?? data.siteName ?? host })}
    >
      {data.image ? <PreviewImage src={data.image} /> : null}
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
  image: { width: '100%', height: 160, borderRadius: radius.sm, marginBottom: spacing.xs, backgroundColor: colors.bg },
  site: { color: colors.textMuted, fontSize: font.xs, textTransform: 'uppercase' },
  title: { color: colors.text, fontSize: font.sm, fontWeight: '700' },
  desc: { color: colors.textMuted, fontSize: font.xs },
  host: { color: colors.link, fontSize: font.xs, marginTop: 2 },
})
