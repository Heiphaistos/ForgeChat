// Carte d'article d'actualité (fil « À la une », rubrique, site) : image ou vignette de repli, site, heure,
// titre, résumé. Un appui ouvre l'article dans le navigateur ; le nom du site ouvre ses articles.
import { Image } from 'expo-image'
import { router } from 'expo-router'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { cleanCategory, type NewsArticle } from '@/api/news'
import { useLang, useT } from '@/i18n'
import { openExternalUrl } from '@/lib/links'
import { colors, font, radius, spacing } from '@/theme'

const host = (link: string) => { try { return new URL(link).hostname.replace(/^www\./, '') } catch { return '' } }
const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)

export function ArticleCard({ a, big, showSite }: { a: NewsArticle & { site?: string; site_id?: string; category?: string }; big?: boolean; showSite?: boolean }) {
  const t = useT()
  const lang = useLang((l) => l.lang)
  const [broken, setBroken] = useState(false)
  const [now] = useState(() => Date.now())
  const mins = Math.round((now - new Date(a.published_at).getTime()) / 60000)
  const when = mins < 1 ? t('news.now') : mins < 60 ? t('news.minAgo', { n: mins }) : mins < 1440 ? t('news.hAgo', { n: Math.round(mins / 60) })
    : new Date(a.published_at).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-US', { day: 'numeric', month: 'short' })
  const label = a.site ?? host(a.link)
  return (
    <Pressable onPress={() => void openExternalUrl(a.link)} style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]} accessibilityRole="link" accessibilityLabel={`${a.title}, ${label}`}>
      <View style={[styles.media, big && { aspectRatio: 16 / 10 }]}>
        {a.image?.startsWith('https://') && !broken ? (
          <Image source={{ uri: a.image }} style={StyleSheet.absoluteFill} contentFit="cover" accessible={false} onError={() => setBroken(true)} />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.fallback, { backgroundColor: `hsl(${hue(label)}, 45%, 25%)` }]}>
            <Text style={styles.fallbackText}>{label.charAt(0).toUpperCase()}</Text>
          </View>
        )}
      </View>
      <View style={styles.body}>
        <View style={styles.metaRow}>
          {showSite && a.site_id ? (
            <Pressable
              hitSlop={8}
              onPress={() => router.push({ pathname: '/news/[siteId]', params: { siteId: a.site_id!, name: label, category: a.category ? cleanCategory(a.category) : '' } })}
              accessibilityRole="button"
            >
              <Text style={styles.site}>{label}</Text>
            </Pressable>
          ) : (
            <Text style={styles.site}>{label}</Text>
          )}
          <Text style={styles.meta}> · {when}</Text>
        </View>
        <Text style={[styles.title, big && { fontSize: font.lg }]} numberOfLines={big ? 4 : 3}>{a.title}</Text>
        {a.summary ? <Text style={styles.summary} numberOfLines={big ? 10 : 6}>{a.summary}</Text> : null}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.bgAlt, borderRadius: radius.lg, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  media: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  fallbackText: { color: 'rgba(255,255,255,0.85)', fontSize: 40, fontWeight: '900' },
  body: { padding: spacing.md, gap: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  site: { color: colors.primary, fontSize: font.xs, fontWeight: '700' },
  meta: { color: colors.textMuted, fontSize: font.xs },
  title: { color: colors.text, fontSize: font.md, fontWeight: '700' },
  summary: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 20 },
})
