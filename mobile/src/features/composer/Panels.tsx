import { Ionicons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { useState, type ReactNode } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { serversApi } from '@/api/servers'
import { colors, font, radius, spacing } from '@/theme'
import { EMOJI_CATEGORIES, GLOBAL_STICKERS, type QuickReply } from './data'
import { formatSticker } from './formats'
import { parseServerStickers } from './stickers'
import { QUICK_REPLY_LIMITS, useComposerPrefs } from './store'

/** Panneau en bas d'écran (sélecteurs de la barre de saisie). */
function BottomPanel({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Fermer" />
      <View style={[styles.panel, { paddingBottom: insets.bottom + spacing.sm }]}>
        <View style={styles.grabber} />
        <View style={styles.titleRow}>
          <Text style={styles.title}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Fermer">
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
  const tabs = [
    ...(recent.length ? [{ key: 'recent', label: '🕘', a11y: 'Récents' }] : []),
    ...EMOJI_CATEGORIES.map((c, i) => ({ key: `c${i}`, label: [...c.label][0] ?? '?', a11y: c.label.replace(/^\S+\s/, '') })),
    ...(customEmojis.size ? [{ key: 'server', label: '⭐', a11y: 'Emojis du serveur' }] : []),
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
    <BottomPanel visible={visible} onClose={onClose} title="Emoji">
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
  const [tab, setTab] = useState<string>(serverId ? 'server' : STICKER_CATEGORIES[0]!)
  const q = useQuery({
    queryKey: ['stickers', serverId],
    queryFn: () => serversApi.stickers(serverId!),
    enabled: visible && !!serverId,
    staleTime: 60_000,
    select: parseServerStickers,
  })
  const tabs = [
    ...(serverId ? [{ key: 'server', label: 'Serveur', a11y: 'Stickers du serveur' }] : []),
    ...STICKER_CATEGORIES.map((c) => ({ key: c, label: c, a11y: c })),
  ]
  const send = (content: string) => {
    onClose()
    onSend(content)
  }
  return (
    <BottomPanel visible={visible} onClose={onClose} title="Stickers">
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
                accessibilityLabel={`Sticker ${s.name}`}
              >
                <Image source={{ uri: s.src }} style={{ width: 64, height: 64 }} contentFit="contain" />
              </Pressable>
            ))
          ) : (
            <Text style={styles.empty}>Aucun sticker sur ce serveur.</Text>
          )
        ) : (
          GLOBAL_STICKERS.filter((s) => s.category === tab).map((s) => (
            <Pressable
              key={s.id}
              onPress={() => send(formatSticker(s))}
              style={styles.stickerCell}
              accessibilityRole="button"
              accessibilityLabel={`Sticker ${s.name}`}
            >
              <Text style={{ fontSize: 44 }}>{s.emoji}</Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </BottomPanel>
  )
}

// ─── Réponses rapides ─────────────────────────────────────────────────────────

/** Réponses rapides (sur l'appareil) : insérées dans le message, modifiables. */
export function QuickRepliesPanel({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (text: string) => void }) {
  const replies = useComposerPrefs((s) => s.quickReplies)
  const save = useComposerPrefs((s) => s.setQuickReplies)
  const [editing, setEditing] = useState<QuickReply[] | null>(null)

  const close = () => {
    setEditing(null)
    onClose()
  }
  const update = (i: number, patch: Partial<QuickReply>) => setEditing((l) => l && l.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  return (
    <BottomPanel visible={visible} onClose={close} title="Réponses rapides">
      {editing ? (
        <ScrollView style={styles.gridScroll} contentContainerStyle={{ padding: spacing.md, gap: spacing.md }} keyboardShouldPersistTaps="handled">
          {editing.map((r, i) => (
            <View key={r.id} style={styles.editRow}>
              <View style={{ flex: 1, gap: spacing.xs }}>
                <TextInput
                  value={r.label}
                  onChangeText={(t) => update(i, { label: t })}
                  placeholder="Nom (ex. Merci)"
                  placeholderTextColor={colors.textFaint}
                  maxLength={QUICK_REPLY_LIMITS.label}
                  style={styles.input}
                  accessibilityLabel={`Nom de la réponse ${i + 1}`}
                />
                <TextInput
                  value={r.content}
                  onChangeText={(t) => update(i, { content: t })}
                  placeholder="Texte inséré"
                  placeholderTextColor={colors.textFaint}
                  maxLength={QUICK_REPLY_LIMITS.content}
                  multiline
                  style={[styles.input, { minHeight: 44 }]}
                  accessibilityLabel={`Texte de la réponse ${i + 1}`}
                />
              </View>
              <Pressable
                onPress={() => setEditing((l) => l && l.filter((_, j) => j !== i))}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Supprimer la réponse ${i + 1}`}
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
                <Text style={styles.buttonText}>Ajouter</Text>
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
              <Text style={styles.buttonText}>Enregistrer</Text>
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
              accessibilityLabel={`Insérer : ${r.content}`}
            >
              <Text style={styles.replyLabel}>{r.label}</Text>
              <Text style={styles.replyContent} numberOfLines={2}>
                {r.content}
              </Text>
            </Pressable>
          ))}
          <Pressable onPress={() => setEditing(replies.map((r) => ({ ...r })))} style={styles.replyRow} accessibilityRole="button">
            <Text style={{ color: colors.link, fontSize: font.md }}>Modifier les réponses rapides</Text>
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
  replyRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: 2 },
  replyLabel: { color: colors.text, fontSize: font.md, fontWeight: '700' },
  replyContent: { color: colors.textMuted, fontSize: font.sm },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  input: { backgroundColor: colors.bgElevated, color: colors.text, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 8, fontSize: font.md },
  button: { flex: 1, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: font.md },
})
