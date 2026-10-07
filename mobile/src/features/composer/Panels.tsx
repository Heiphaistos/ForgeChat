import { Ionicons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import * as DocumentPicker from 'expo-document-picker'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { gifsApi } from '@/api/gifs'
import { serversApi } from '@/api/servers'
import type { LocalAttachment } from '@/features/chat/useConversation'
import { useT, type Key } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { colors, font, radius, spacing } from '@/theme'
import { EMOJI_CATEGORIES, GLOBAL_STICKERS, type QuickReply } from './data'
import { formatSticker } from './formats'
import { gifSearchEnabled, gifSource, parseGifResults, type GifResult } from './gifs'
import { parseServerStickers } from './stickers'
import { QUICK_REPLY_LIMITS, useComposerPrefs } from './store'

/** Panneau en bas d'écran (sélecteurs de la barre de saisie). */
function BottomPanel({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const insets = useSafeAreaInsets()
  const t = useT()
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.close')} />
      <View style={[styles.panel, { paddingBottom: insets.bottom + spacing.sm }]}>
        <View style={styles.grabber} />
        <View style={styles.titleRow}>
          <Text style={styles.title}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.close')}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </Pressable>
        </View>
        {children}
      </View>
    </Modal>
  )
}

function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string; a11y: string }[]; value: T; onChange: (k: T) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
      {tabs.map((t) => (
        <Pressable
          key={t.key}
          onPress={() => onChange(t.key)}
          style={[styles.tab, value === t.key && styles.tabActive]}
          accessibilityRole="tab"
          accessibilityLabel={t.a11y}
          accessibilityState={{ selected: value === t.key }}
        >
          <Text style={styles.tabText}>{t.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  )
}

// ─── Emoji ────────────────────────────────────────────────────────────────────

/** Noms des catégories de data.ts (même ordre), traduits au rendu. */
const EMOJI_CATEGORY_KEYS: readonly Key[] = [
  'panel.emoji.smileys',
  'panel.emoji.gestures',
  'panel.emoji.hearts',
  'panel.emoji.animals',
  'panel.emoji.food',
  'panel.emoji.sports',
  'panel.emoji.nature',
  'panel.emoji.objects',
]

/** Emojis Unicode (catégories du web), récents, et emojis du serveur insérés en « :nom: ». */
export function EmojiPanel({
  visible,
  onClose,
  onPick,
  customEmojis,
}: {
  visible: boolean
  onClose: () => void
  onPick: (text: string) => void
  customEmojis: ReadonlyMap<string, string>
}) {
  const recent = useComposerPrefs((s) => s.recentEmojis)
  const remember = useComposerPrefs((s) => s.rememberEmoji)
  const t = useT()
  const tabs = [
    ...(recent.length ? [{ key: 'recent', label: '🕘', a11y: t('panel.emoji.recent') }] : []),
    ...EMOJI_CATEGORIES.map((c, i) => ({ key: `c${i}`, label: [...c.label][0] ?? '?', a11y: EMOJI_CATEGORY_KEYS[i] ? t(EMOJI_CATEGORY_KEYS[i]) : c.label.replace(/^\S+\s/, '') })),
    ...(customEmojis.size ? [{ key: 'server', label: '⭐', a11y: t('chat.serverEmojis') }] : []),
  ]
  const [tab, setTab] = useState<string>(tabs[0]!.key)
  const current = tabs.some((t) => t.key === tab) ? tab : tabs[0]!.key
  const pick = (text: string, emoji: string) => {
    remember(emoji)
    onPick(text)
  }
  const list: readonly string[] =
    current === 'recent' ? recent : current.startsWith('c') ? (EMOJI_CATEGORIES[Number(current.slice(1))]?.emojis ?? []) : []

  return (
    <BottomPanel visible={visible} onClose={onClose} title={t('composer.emoji')}>
      <Tabs tabs={tabs} value={current} onChange={setTab} />
      <ScrollView style={styles.gridScroll} contentContainerStyle={styles.grid} keyboardShouldPersistTaps="always">
        {current === 'server'
          ? [...customEmojis].map(([name, url]) => (
              <Pressable
                key={name}
                onPress={() => pick(`:${name}:`, `:${name}:`)}
                style={styles.cell}
                accessibilityRole="button"
                accessibilityLabel={`:${name}:`}
              >
                <Image source={{ uri: url }} style={{ width: 30, height: 30 }} contentFit="contain" />
              </Pressable>
            ))
          : list.map((e) =>
              e.startsWith(':') ? null : (
                <Pressable key={e} onPress={() => pick(e, e)} style={styles.cell} accessibilityRole="button" accessibilityLabel={e}>
                  <Text style={styles.emoji}>{e}</Text>
                </Pressable>
              ),
            )}
      </ScrollView>
    </BottomPanel>
  )
}

// ─── Stickers ─────────────────────────────────────────────────────────────────

const STICKER_CATEGORIES = [...new Set(GLOBAL_STICKERS.map((s) => s.category))]
/** Catégories de data.ts traduites au rendu (inconnue : nom tel quel). */
const STICKER_CATEGORY_KEYS: Readonly<Record<string, Key>> = { Réactions: 'panel.sticker.reactions', Animaux: 'panel.emoji.animals' }

/** Stickers du serveur (images) et stickers globaux (emoji en grand), envoyés au format du web. */
export function StickerPanel({
  visible,
  onClose,
  onSend,
  serverId,
}: {
  visible: boolean
  onClose: () => void
  onSend: (content: string) => void
  serverId?: string
}) {
  const t = useT()
  const [tab, setTab] = useState<string>(serverId ? 'server' : STICKER_CATEGORIES[0]!)
  const q = useQuery({
    queryKey: ['stickers', serverId],
    queryFn: () => serversApi.stickers(serverId!),
    enabled: visible && !!serverId,
    staleTime: 60_000,
    select: parseServerStickers,
  })
  const tabs = [
    ...(serverId ? [{ key: 'server', label: t('panel.server'), a11y: t('panel.sticker.serverA11y') }] : []),
    ...STICKER_CATEGORIES.map((c) => {
      const k = STICKER_CATEGORY_KEYS[c]
      const label = k ? t(k) : c
      return { key: c, label, a11y: label }
    }),
  ]
  const send = (content: string) => {
    onClose()
    onSend(content)
  }
  return (
    <BottomPanel visible={visible} onClose={onClose} title={t('composer.stickers')}>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <ScrollView style={styles.gridScroll} contentContainerStyle={styles.grid}>
        {tab === 'server' ? (
          q.isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ margin: spacing.xl }} />
          ) : q.data?.length ? (
            q.data.map((s) => (
              <Pressable
                key={s.id}
                onPress={() => send(formatSticker({ name: s.name, url: s.url }))}
                style={styles.stickerCell}
                accessibilityRole="button"
                accessibilityLabel={t('panel.sticker.label', { name: s.name })}
              >
                <Image source={{ uri: s.src }} style={{ width: 64, height: 64 }} contentFit="contain" />
              </Pressable>
            ))
          ) : (
            <Text style={styles.empty}>{t('panel.sticker.empty')}</Text>
          )
        ) : (
          GLOBAL_STICKERS.filter((s) => s.category === tab).map((s) => (
            <Pressable
              key={s.id}
              onPress={() => send(formatSticker(s))}
              style={styles.stickerCell}
              accessibilityRole="button"
              accessibilityLabel={t('panel.sticker.label', { name: s.name })}
            >
              <Text style={{ fontSize: 44 }}>{s.emoji}</Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </BottomPanel>
  )
}

// ─── GIF ───────────────────────────────────────────────────────────────────────

const useGifStatus = () =>
  useQuery({ queryKey: ['gifs-status'], queryFn: () => gifsApi.status(), staleTime: 10 * 60_000, retry: false })

/** La recherche GIF du serveur est-elle disponible ? Sinon : onglet caché. */
export function useGifSearchAvailable(): boolean {
  return gifSearchEnabled(useGifStatus().data)
}

/**
 * GIF : recherche par le serveur (GIPHY ou Wikimedia, si disponible), GIF animés ajoutés au serveur (stickers .gif),
 * et GIF du téléphone envoyés tels quels en pièce jointe (l'animation est conservée).
 */
export function GifPanel({
  visible,
  onClose,
  onSendContent,
  onSendFile,
  serverId,
  searchAvailable,
}: {
  visible: boolean
  onClose: () => void
  onSendContent: (content: string) => void
  onSendFile: (file: LocalAttachment) => void
  serverId?: string
  searchAvailable: boolean
}) {
  const t = useT()
  const tabs = [
    ...(searchAvailable ? [{ key: 'search', label: t('panel.gif.search'), a11y: t('panel.gif.searchA11y') }] : []),
    ...(serverId ? [{ key: 'server', label: t('panel.server'), a11y: t('panel.gif.serverA11y') }] : []),
    { key: 'phone', label: t('panel.gif.phone'), a11y: t('panel.gif.phoneA11y') },
  ]
  const [tab, setTab] = useState<string>(tabs[0]!.key)
  const current = tabs.some((t) => t.key === tab) ? tab : tabs[0]!.key
  const send = (content: string) => {
    onClose()
    onSendContent(content)
  }

  const serverGifs = useQuery({
    queryKey: ['stickers', serverId],
    queryFn: () => serversApi.stickers(serverId!),
    enabled: visible && !!serverId && current === 'server',
    staleTime: 60_000,
    select: (raw: unknown) => parseServerStickers(raw).filter((s) => /\.gif$/i.test(s.url)),
  })

  const pickPhoneGif = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: 'image/gif', copyToCacheDirectory: true, multiple: false })
    if (res.canceled || !res.assets[0]) return
    const a = res.assets[0]
    const name = (a.name || `gif-${Date.now()}.gif`).replace(/[^\p{L}\p{N}._ -]/gu, '_').replace(/\.[^.]*$/, '') + '.gif'
    if (a.mimeType && a.mimeType !== 'image/gif') {
      Alert.alert(t('panel.gif.notGif'), t('panel.gif.notGifBody'))
      return
    }
    onClose()
    onSendFile({ uri: a.uri, name, type: 'image/gif', size: a.size ?? null })
  }

  return (
    <BottomPanel visible={visible} onClose={onClose} title="GIF">
      <Tabs tabs={tabs} value={current} onChange={setTab} />
      {current === 'search' ? (
        <GifSearch visible={visible} onPick={(g) => send(g.url)} />
      ) : current === 'server' ? (
        <ScrollView style={styles.gridScroll} contentContainerStyle={styles.grid}>
          {serverGifs.isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ margin: spacing.xl }} />
          ) : serverGifs.data?.length ? (
            serverGifs.data.map((s) => (
              <Pressable
                key={s.id}
                onPress={() => send(formatSticker({ name: s.name, url: s.url }))}
                style={styles.stickerCell}
                accessibilityRole="button"
                accessibilityLabel={t('panel.gif.label', { name: s.name })}
              >
                <Image source={{ uri: s.src }} style={{ width: 72, height: 72 }} contentFit="contain" autoplay />
              </Pressable>
            ))
          ) : (
            <Text style={styles.empty}>{t('panel.gif.serverEmpty')}</Text>
          )}
        </ScrollView>
      ) : (
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <Text style={{ color: colors.textMuted, fontSize: font.sm }}>
            {t('panel.gif.phoneHint')}
          </Text>
          <Pressable onPress={() => void pickPhoneGif()} style={[styles.button, { backgroundColor: colors.primary, flex: 0 }]} accessibilityRole="button">
            <Text style={styles.buttonText}>{t('panel.gif.pick')}</Text>
          </Pressable>
        </View>
      )}
    </BottomPanel>
  )
}

/** Recherche GIF via le serveur ; tendances quand le champ est vide. */
function GifSearch({ visible, onPick }: { visible: boolean; onPick: (g: GifResult) => void }) {
  const source = gifSource(useGifStatus().data)
  const tr = useT()
  const [text, setText] = useState('')
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<GifResult[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ctrl = useRef<AbortController | null>(null)
  // 3 colonnes à taille fixe (une largeur en % + image en position absolue donnait des cases de taille nulle).
  const cell = Math.floor((useWindowDimensions().width - spacing.sm * 2 - 8 * 3) / 3)

  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), 400)
    return () => clearTimeout(t)
  }, [text])

  const load = async (q: string, pos: string | null) => {
    ctrl.current?.abort()
    const c = new AbortController()
    ctrl.current = c
    setLoading(true)
    setError(null)
    try {
      const raw = q ? await gifsApi.search(q, pos ?? undefined, c.signal) : await gifsApi.trending(pos ?? undefined, c.signal)
      const page = parseGifResults(raw)
      setItems((prev) => (pos ? [...prev, ...page.results] : page.results))
      setNext(page.next)
    } catch (e) {
      if (!c.signal.aborted) setError(errorMessage(e))
    } finally {
      if (ctrl.current === c) setLoading(false)
    }
  }

  useEffect(() => {
    if (!visible) return
    const t = setTimeout(() => void load(query, null), 0)
    return () => {
      clearTimeout(t)
      ctrl.current?.abort()
    }
  }, [query, visible])

  return (
    <View>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={source.placeholder}
        placeholderTextColor={colors.textFaint}
        style={[styles.input, { marginHorizontal: spacing.md, marginBottom: spacing.sm }]}
        accessibilityLabel={tr('panel.gif.searchA11y')}
        returnKeyType="search"
        maxLength={100}
      />
      <ScrollView
        style={styles.gridScroll}
        contentContainerStyle={styles.grid}
        keyboardShouldPersistTaps="handled"
        onScroll={(e) => {
          const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent
          if (!loading && next && layoutMeasurement.height + contentOffset.y > contentSize.height - 200) void load(query, next)
        }}
        scrollEventThrottle={200}
      >
        {items.map((g) => (
          <Pressable key={g.id + g.url} onPress={() => onPick(g)} style={[styles.gifCell, { width: cell, height: cell }]} accessibilityRole="button" accessibilityLabel={g.title || 'GIF'}>
            <Image source={{ uri: g.preview }} style={{ width: cell, height: cell }} contentFit="cover" autoplay />
          </Pressable>
        ))}
        {loading ? <ActivityIndicator color={colors.primary} style={{ margin: spacing.lg, width: '100%' }} /> : null}
        {error ? <Text style={styles.empty}>{error}</Text> : null}
        {!loading && !error && !items.length ? <Text style={styles.empty}>{tr('panel.gif.none')}</Text> : null}
      </ScrollView>
      {source.attribution ? <Text style={styles.attribution}>{source.attribution}</Text> : null}
    </View>
  )
}

// ─── Réponses rapides ─────────────────────────────────────────────────────────

/** Réponses rapides (sur l'appareil) : insérées dans le message, modifiables. */
export function QuickRepliesPanel({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (text: string) => void }) {
  const replies = useComposerPrefs((s) => s.quickReplies)
  const save = useComposerPrefs((s) => s.setQuickReplies)
  const [editing, setEditing] = useState<QuickReply[] | null>(null)
  const t = useT()

  const close = () => {
    setEditing(null)
    onClose()
  }
  const update = (i: number, patch: Partial<QuickReply>) => setEditing((l) => l && l.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  return (
    <BottomPanel visible={visible} onClose={close} title={t('composer.quickReplies')}>
      {editing ? (
        <ScrollView style={styles.gridScroll} contentContainerStyle={{ padding: spacing.md, gap: spacing.md }} keyboardShouldPersistTaps="handled">
          {editing.map((r, i) => (
            <View key={r.id} style={styles.editRow}>
              <View style={{ flex: 1, gap: spacing.xs }}>
                <TextInput
                  value={r.label}
                  onChangeText={(v) => update(i, { label: v })}
                  placeholder={t('panel.quick.namePlaceholder')}
                  placeholderTextColor={colors.textFaint}
                  maxLength={QUICK_REPLY_LIMITS.label}
                  style={styles.input}
                  accessibilityLabel={t('panel.quick.nameA11y', { n: i + 1 })}
                />
                <TextInput
                  value={r.content}
                  onChangeText={(v) => update(i, { content: v })}
                  placeholder={t('panel.quick.textPlaceholder')}
                  placeholderTextColor={colors.textFaint}
                  maxLength={QUICK_REPLY_LIMITS.content}
                  multiline
                  style={[styles.input, { minHeight: 44 }]}
                  accessibilityLabel={t('panel.quick.textA11y', { n: i + 1 })}
                />
              </View>
              <Pressable
                onPress={() => setEditing((l) => l && l.filter((_, j) => j !== i))}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('panel.quick.deleteA11y', { n: i + 1 })}
              >
                <Ionicons name="trash-outline" size={20} color={colors.danger} />
              </Pressable>
            </View>
          ))}
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            {editing.length < QUICK_REPLY_LIMITS.count ? (
              <Pressable
                onPress={() => setEditing((l) => l && [...l, { id: String(Date.now()), label: '', content: '' }])}
                style={[styles.button, { backgroundColor: colors.bgHover }]}
                accessibilityRole="button"
              >
                <Text style={styles.buttonText}>{t('panel.add')}</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => {
                save(editing)
                setEditing(null)
              }}
              style={[styles.button, { backgroundColor: colors.primary }]}
              accessibilityRole="button"
            >
              <Text style={styles.buttonText}>{t('composer.save')}</Text>
            </Pressable>
          </View>
        </ScrollView>
      ) : (
        <ScrollView style={styles.gridScroll}>
          {replies.map((r) => (
            <Pressable
              key={r.id}
              onPress={() => {
                close()
                onPick(r.content)
              }}
              style={({ pressed }) => [styles.replyRow, pressed && { backgroundColor: colors.bgHover }]}
              accessibilityRole="button"
              accessibilityLabel={t('panel.quick.insert', { text: r.content })}
            >
              <Text style={styles.replyLabel}>{r.label}</Text>
              <Text style={styles.replyContent} numberOfLines={2}>
                {r.content}
              </Text>
            </Pressable>
          ))}
          <Pressable onPress={() => setEditing(replies.map((r) => ({ ...r })))} style={styles.replyRow} accessibilityRole="button">
            <Text style={{ color: colors.link, fontSize: font.md }}>{t('panel.quick.edit')}</Text>
          </Pressable>
        </ScrollView>
      )}
    </BottomPanel>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  panel: { backgroundColor: colors.bgAlt, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: spacing.sm },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.bgHover, marginBottom: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  title: { color: colors.text, fontSize: font.md, fontWeight: '700' },
  tabs: { gap: spacing.xs, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  tab: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.sm },
  tabActive: { backgroundColor: colors.bgHover },
  tabText: { color: colors.text, fontSize: font.md },
  gridScroll: { maxHeight: 340 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.sm, paddingBottom: spacing.md },
  cell: { width: '12.5%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 28 },
  stickerCell: { width: '25%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: colors.textMuted, padding: spacing.lg },
  gifCell: { margin: 4, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.bgElevated },
  attribution: { color: colors.textFaint, fontSize: font.xs, textAlign: 'right', paddingHorizontal: spacing.md },
  replyRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: 2 },
  replyLabel: { color: colors.text, fontSize: font.md, fontWeight: '700' },
  replyContent: { color: colors.textMuted, fontSize: font.sm },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  input: { backgroundColor: colors.bgElevated, color: colors.text, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 8, fontSize: font.md },
  button: { flex: 1, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: font.md },
})
