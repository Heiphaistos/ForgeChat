import { Ionicons } from '@expo/vector-icons'
import * as Clipboard from 'expo-clipboard'
import * as DocumentPicker from 'expo-document-picker'
import { router } from 'expo-router'
import { useCallback, useState, type ReactElement } from 'react'
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type LayoutChangeEvent } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import Animated from 'react-native-reanimated'
import { Sheet, type SheetAction } from '@/components/Sheet'
import { ErrorState, Loading } from '@/components/ui'
import { LIMITS } from '@/config/env'
import { hasEditableText } from '@/features/composer/formats'
import { QUICK_REACTIONS } from '@/lib/emojis'
import { isSameDay } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { useKeyboardSafeBottom } from '@/lib/safeBottom'
import { useT } from '@/i18n'
import { useAuth } from '@/stores/auth'
import type { ChatMessage } from '@/types/models'
import { colors, font, radius, spacing } from '@/theme'
import { MessageItem } from './MessageItem'
import { sanitizeFilename, validateAttachment, type LocalAttachment } from './useConversation'

const MAX_FILES = 10

/**
 * Conversation secondaire (fil de discussion, publication de forum) : messages, réactions rapides,
 * copie, modification et suppression, et une zone de réponse avec pièces jointes.
 * `messages` : du plus récent au plus ancien.
 */
export function ReplyThreadView({
  messages,
  isLoading,
  error,
  onRetry,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  onReact,
  onSend,
  onEdit,
  onDelete,
  canModerate,
  header,
  disabledReason,
  placeholder,
}: {
  messages: ChatMessage[]
  isLoading: boolean
  error: unknown
  onRetry: () => void
  hasOlder: boolean
  loadingOlder: boolean
  onLoadOlder: () => void
  onReact: (m: ChatMessage, emoji: string) => void
  onSend: (text: string, files: LocalAttachment[]) => Promise<unknown>
  /** Ses propres messages (le serveur refuse les autres). */
  onEdit?: (m: ChatMessage, text: string) => Promise<unknown>
  /** Ses messages, ou tous avec MANAGE_MESSAGES (`canModerate`). */
  onDelete?: (m: ChatMessage) => Promise<unknown>
  canModerate?: boolean
  header?: ReactElement
  disabledReason?: string | null
  placeholder: string
}) {
  const t = useT()
  const me = useAuth((s) => s.user)
  const [draft, setDraft] = useState('')
  const [files, setFiles] = useState<LocalAttachment[]>([])
  const [editing, setEditing] = useState<ChatMessage | null>(null)
  const [sending, setSending] = useState(false)
  const [selected, setSelected] = useState<ChatMessage | null>(null)
  const safeBottom = useKeyboardSafeBottom(spacing.sm)
  const [topOffset, setTopOffset] = useState(0)
  const onKavLayout = useCallback((e: LayoutChangeEvent) => {
    e.target.measureInWindow((_x, y) => setTopOffset((prev) => (Math.abs(prev - y) > 0.5 ? y : prev)))
  }, [])
  const onPressAuthor = useCallback((userId: string) => router.push(`/user/${userId}`), [])

  const text = draft.trim()
  const canSubmit = !sending && (editing ? !!text : !!text || files.length > 0)
  const submit = () => {
    if (!canSubmit) return
    setSending(true)
    const sent = files
    ;(editing && onEdit ? onEdit(editing, text) : onSend(text, sent))
      .then(() => {
        setDraft('')
        setEditing(null)
        setFiles((prev) => prev.filter((f) => !sent.includes(f)))
      })
      .catch((e) => Alert.alert(editing ? t('social.reply.editFailed') : t('composer.sendFailed'), errorMessage(e)))
      .finally(() => setSending(false))
  }

  const pickFiles = async () => {
    const res = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true })
    if (res.canceled) return
    const accepted: LocalAttachment[] = []
    for (const a of res.assets) {
      const f = { uri: a.uri, name: sanitizeFilename(a.name), type: a.mimeType ?? 'application/octet-stream', size: a.size ?? null }
      const err = validateAttachment(f)
      if (err) Alert.alert(t('composer.fileRejected'), t('social.reply.fileError', { name: f.name, error: err }))
      else accepted.push(f)
    }
    setFiles((prev) => [...prev, ...accepted].slice(0, MAX_FILES))
  }

  const confirmDelete = (m: ChatMessage) =>
    Alert.alert(t('chat.deleteConfirm'), t('chat.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => void onDelete?.(m).catch((e) => Alert.alert(t('chat.deleteFailed'), errorMessage(e))) },
    ])

  const actionsFor = (m: ChatMessage): SheetAction[] => {
    const mine = !!me && m.authorId === me.id
    const list: SheetAction[] = []
    if (m.content) list.push({ label: t('chat.copyText'), icon: 'copy-outline', onPress: () => void Clipboard.setStringAsync(m.content ?? '') })
    if (mine && onEdit && hasEditableText(m) && !disabledReason)
      list.push({
        label: t('chat.edit'),
        icon: 'create-outline',
        onPress: () => {
          setEditing(m)
          setDraft(m.content ?? '')
        },
      })
    if (onDelete && (mine || canModerate)) list.push({ label: t('common.delete'), icon: 'trash-outline', danger: true, onPress: () => confirmDelete(m) })
    return list
  }

  let body: React.ReactNode
  if (isLoading) body = <Loading />
  else if (error && !messages.length) body = <ErrorState message={errorMessage(error)} onRetry={onRetry} />
  else
    body = (
      <FlatList
        data={messages}
        inverted
        keyExtractor={(m) => m.id}
        renderItem={({ item, index }) => {
          const prev = messages[index + 1]
          return (
            <MessageItem
              message={item}
              grouped={false}
              daySeparator={!prev || !isSameDay(prev.createdAt, item.createdAt)}
              myId={me?.id ?? ''}
              myName={me?.username ?? ''}
              onLongPress={setSelected}
              onReact={onReact}
              onPressAuthor={onPressAuthor}
              onRetry={setSelected}
            />
          )
        }}
        onEndReached={() => hasOlder && !loadingOlder && onLoadOlder()}
        onEndReachedThreshold={0.4}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerStyle={{ paddingVertical: spacing.sm }}
        ListFooterComponent={loadingOlder ? <ActivityIndicator color={colors.primary} style={{ margin: spacing.lg }} /> : hasOlder ? null : header}
      />
    )

  return (
    <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={topOffset} onLayout={onKavLayout} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flex: 1 }}>{body}</View>
      <Animated.View style={[styles.bar, safeBottom]}>
        {disabledReason ? (
          <Text style={styles.disabled}>{disabledReason}</Text>
        ) : (
          <>
            {editing ? (
              <View style={styles.contextBar}>
                <Ionicons name="create-outline" size={16} color={colors.textMuted} />
                <Text style={styles.contextText}>{t('composer.editing')}</Text>
                <Pressable
                  onPress={() => {
                    setEditing(null)
                    setDraft('')
                  }}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={t('social.reply.cancelEdit')}
                >
                  <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                </Pressable>
              </View>
            ) : null}
            {files.length && !editing ? (
              <ScrollView horizontal contentContainerStyle={styles.files} keyboardShouldPersistTaps="handled">
                {files.map((f, i) => (
                  <View key={`${f.uri}-${i}`} style={styles.fileChip}>
                    <Ionicons name={f.type.startsWith('image/') ? 'image-outline' : 'document-outline'} size={14} color={colors.textMuted} />
                    <Text style={styles.fileName} numberOfLines={1}>
                      {f.name}
                    </Text>
                    <Pressable onPress={() => setFiles((prev) => prev.filter((_, j) => j !== i))} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('composer.remove', { name: f.name })}>
                      <Ionicons name="close" size={14} color={colors.textMuted} />
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            ) : null}
            <View style={styles.row}>
              {editing ? null : (
                <Pressable style={styles.attach} onPress={() => void pickFiles()} accessibilityRole="button" accessibilityLabel={t('composer.attach')} hitSlop={6}>
                  <Ionicons name="add" size={24} color={colors.textSecondary} />
                </Pressable>
              )}
              <TextInput
                style={styles.input}
                value={draft}
                onChangeText={setDraft}
                placeholder={placeholder}
                placeholderTextColor={colors.textFaint}
                multiline
                maxLength={LIMITS.messageMaxChars}
                accessibilityLabel={editing ? t('social.reply.edited') : t('social.reply.reply')}
                textAlignVertical="center"
              />
              <Pressable
                style={[styles.send, { backgroundColor: canSubmit ? colors.primary : colors.bgHover }]}
                onPress={submit}
                disabled={!canSubmit}
                accessibilityRole="button"
                accessibilityLabel={editing ? t('composer.save') : t('composer.send')}
                accessibilityState={{ disabled: !canSubmit, busy: sending }}
              >
                {sending ? <ActivityIndicator color="#fff" /> : <Ionicons name={editing ? 'checkmark' : 'send'} size={18} color="#fff" />}
              </Pressable>
            </View>
          </>
        )}
      </Animated.View>
      <Sheet
        visible={!!selected}
        onClose={() => setSelected(null)}
        header={
          <View style={styles.quickRow}>
            {QUICK_REACTIONS.map((e) => (
              <Pressable
                key={e}
                style={styles.quick}
                onPress={() => {
                  const m = selected
                  setSelected(null)
                  if (m) onReact(m, e)
                }}
                accessibilityRole="button"
                accessibilityLabel={t('chat.reactWith', { emoji: e })}
              >
                <Text style={{ fontSize: 24 }}>{e}</Text>
              </Pressable>
            ))}
          </View>
        }
        actions={selected ? actionsFor(selected) : []}
      />
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  contextBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.bgAlt },
  contextText: { flex: 1, color: colors.textMuted, fontSize: font.sm },
  files: { gap: spacing.sm, paddingHorizontal: spacing.sm, paddingTop: spacing.sm },
  fileChip: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 180, backgroundColor: colors.bgElevated, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4 },
  fileName: { color: colors.textSecondary, fontSize: font.xs, flexShrink: 1 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingTop: spacing.sm },
  attach: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.bgElevated, alignItems: 'center', justifyContent: 'center' },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 140,
    backgroundColor: colors.bgElevated,
    borderRadius: 20,
    paddingHorizontal: spacing.lg,
    paddingTop: 10,
    paddingBottom: 10,
    color: colors.text,
    fontSize: font.md,
  },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  disabled: { color: colors.textMuted, fontSize: font.sm, textAlign: 'center', padding: spacing.md },
  quickRow: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  quick: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.bgElevated, alignItems: 'center', justifyContent: 'center' },
})
