// Détail d'un tutoriel : lecteur vidéo (expo-video, comme les vidéos de messages) puis texte rendu en natif.
import { useQuery } from '@tanstack/react-query'
import { Stack, useLocalSearchParams } from 'expo-router'
import { useVideoPlayer, VideoView } from 'expo-video'
import { useMemo } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { EmptyState, ErrorState, Loading } from '@/components/ui'
import { tutorialsApi } from '@/features/tutorials/api'
import { parseTutorialHtml, safeHttp } from '@/features/tutorials/html'
import { TutorialBody } from '@/features/tutorials/TutorialBody'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { colors, font, radius, spacing } from '@/theme'

/** `src` est déjà validée https : le lecteur natif ne reçoit jamais autre chose. */
function Video({ src, label }: { src: string; label: string }) {
  const player = useVideoPlayer(src)
  return (
    <View style={styles.video} accessibilityLabel={label}>
      <VideoView player={player} nativeControls contentFit="contain" fullscreenOptions={{ enable: true }} style={StyleSheet.absoluteFill} />
    </View>
  )
}

export default function TutorialScreen() {
  const t = useT()
  const { slug } = useLocalSearchParams<{ slug: string }>()
  const q = useQuery({ queryKey: ['tutorials', 'one', slug], queryFn: () => tutorialsApi.one(slug), enabled: !!slug, staleTime: 300_000 })
  const tuto = q.data
  const nodes = useMemo(() => parseTutorialHtml(tuto?.content_html ?? ''), [tuto?.content_html])
  const video = safeHttp(tuto?.video_url, true)

  return (
    <>
      <Stack.Screen options={{ title: tuto?.category.name ?? t('tuto.title') }} />
      {q.isLoading ? (
        <Loading />
      ) : q.error || !tuto ? (
        <ErrorState message={errorMessage(q.error, t('tuto.error'))} onRetry={() => void q.refetch()} />
      ) : (
        <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
          {video ? <Video src={video} label={tuto.title} /> : <EmptyState icon="videocam-off-outline" title={t('tuto.noVideo')} />}
          <Text style={styles.title} accessibilityRole="header">{tuto.title}</Text>
          {tuto.group ? <Text style={styles.meta}>{tuto.category.name} · {tuto.group}</Text> : null}
          {tuto.description ? <Text style={styles.desc}>{tuto.description}</Text> : null}
          <TutorialBody nodes={nodes} />
          {tuto.tags.length ? (
            <View accessibilityLabel={t('tuto.tags')} style={styles.tags}>
              {tuto.tags.map((tag) => <Text key={tag} style={styles.tag}>#{tag}</Text>)}
            </View>
          ) : null}
        </ScrollView>
      )}
    </>
  )
}

const styles = StyleSheet.create({
  video: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius.md, overflow: 'hidden', backgroundColor: '#000' },
  title: { color: colors.text, fontSize: font.xl, fontWeight: '800' },
  meta: { color: colors.textMuted, fontSize: font.sm, fontWeight: '600' },
  desc: { color: colors.textMuted, fontSize: font.md },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tag: { color: colors.textMuted, fontSize: font.sm, backgroundColor: colors.bgAlt, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.full, overflow: 'hidden' },
})
