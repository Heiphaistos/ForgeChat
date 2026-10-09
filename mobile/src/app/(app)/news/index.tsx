// Actualités : « À la une » mêle tous les sites ; la navigation par rubriques suit l'un des 10 thèmes choisis
// par le compte (molette de l'en-tête, préférences synchronisées avec le web et le PC) ; recherche plein texte.
// Les cartes d'articles sont les mêmes pour tous les thèmes.
import { Ionicons } from '@expo/vector-icons'
import { router, Stack } from 'expo-router'
import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { EmptyState, ErrorState, IconButton, Loading } from '@/components/ui'
import { Feed } from '@/features/news/Feed'
import { shownTheme, type ThemeId, type View as NewsView } from '@/features/news/logic'
import { loadNewsPrefs } from '@/features/news/prefs'
import { useNewsData, type Nav } from '@/features/news/shared'
import Theme1Sidebar from '@/features/news/themes/Theme1Sidebar'
import Theme2Chips from '@/features/news/themes/Theme2Chips'
import Theme3Tiles from '@/features/news/themes/Theme3Tiles'
import Theme4Tabs from '@/features/news/themes/Theme4Tabs'
import Theme5Rail from '@/features/news/themes/Theme5Rail'
import Theme6Pins from '@/features/news/themes/Theme6Pins'
import Theme7Mega from '@/features/news/themes/Theme7Mega'
import Theme8Tabs from '@/features/news/themes/Theme8Tabs'
import Theme9Columns from '@/features/news/themes/Theme9Columns'
import { errorMessage } from '@/lib/http'
import { colors, font, outline, radius, spacing } from '@/theme'

/** Thèmes dont la navigation s'ouvre en feuille depuis le bas (colonne latérale sur grand écran). */
const SHEET: Partial<Record<ThemeId, ComponentType<{ nav: Nav }>>> = { 1: Theme1Sidebar, 5: Theme5Rail, 6: Theme6Pins, 8: Theme8Tabs }

export default function NewsScreen() {
  const { q, all, ...data } = useNewsData()
  const { t, prefs } = data
  const insets = useSafeAreaInsets()
  const [view, setView] = useState<NewsView>({ kind: 'top' })
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [sheet, setSheet] = useState(false)
  useEffect(() => { void loadNewsPrefs() }, [])
  useEffect(() => {
    const h = setTimeout(() => setQuery(search.trim()), 300)
    return () => clearTimeout(h)
  }, [search])

  const pick = (v: NewsView) => { setView(v); setSearch(''); setQuery(''); setSheet(false) }
  const openSettings = () => { setSheet(false); router.push('/news/settings') }
  const muted = new Set(prefs.muted)
  const nav: Nav = { ...data, view, pick, openSettings }
  const theme = shownTheme(prefs.theme)
  const SheetNav = SHEET[theme]
  const refresh = () => void q.refetch()

  const bar = (lead?: ReactNode) => (
    <View style={styles.bar}>
      {lead}
      <View style={styles.search}>
        <Ionicons name="search" size={16} color={colors.textMuted} />
        <TextInput value={search} onChangeText={setSearch} placeholder={t('news.search')} placeholderTextColor={colors.textMuted} returnKeyType="search" style={styles.searchInput} accessibilityLabel={t('news.search')} />
        {search ? (
          <Pressable onPress={() => setSearch('')} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('news.clearSearch')}>
            <Ionicons name="close-circle" size={16} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {theme === 7 ? <Theme7Mega nav={nav} /> : null}
      {SheetNav ? <IconButton icon="list" label={t('news.rubrics')} onPress={() => setSheet(true)} active /> : null}
    </View>
  )

  let body: ReactNode
  if (q.isLoading) body = <Loading />
  else if (q.error) body = <ErrorState message={errorMessage(q.error)} onRetry={refresh} />
  else if (!all.length) body = <EmptyState icon="newspaper-outline" title={t('news.empty')} />
  else if (theme === 9 || theme === 10) {
    body = <Theme9Columns nav={nav} compact={theme === 10} feed={(lead) => <Feed view={view} query={query} muted={muted} onRefresh={refresh} header={bar(lead)} />} />
  } else {
    const header = (
      <>
        {bar()}
        {theme === 2 ? <Theme2Chips nav={nav} /> : null}
        {theme === 4 ? <Theme4Tabs nav={nav} /> : null}
        {theme === 3 && !query ? <Theme3Tiles nav={nav} /> : null}
      </>
    )
    body = <Feed view={view} query={query} muted={muted} onRefresh={refresh} header={header} />
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ headerRight: () => <IconButton icon="settings-outline" label={t('news.customize')} onPress={openSettings} /> }} />
      {body}
      {SheetNav ? (
        <Modal visible={sheet} transparent animationType="slide" onRequestClose={() => setSheet(false)} statusBarTranslucent>
          <Pressable style={styles.backdrop} onPress={() => setSheet(false)} accessibilityRole="button" accessibilityLabel={t('common.close')} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom }, theme === 5 ? { height: '80%' } : { maxHeight: '85%' }]} accessibilityViewIsModal>
            <Pressable onPress={() => setSheet(false)} style={{ paddingVertical: spacing.sm }} accessibilityRole="button" accessibilityLabel={t('common.close')}>
              <View style={styles.grabber} />
            </Pressable>
            <ScrollView keyboardShouldPersistTaps="handled">
              <SheetNav nav={nav} />
            </ScrollView>
          </View>
        </Modal>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.bgAlt, borderRadius: radius.md, paddingHorizontal: spacing.md, ...outline },
  searchInput: { flex: 1, color: colors.text, fontSize: font.md, paddingVertical: 8 },
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  sheet: { backgroundColor: colors.bgAlt, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, ...outline },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.bgHover },
})
