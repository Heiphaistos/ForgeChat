import { Ionicons } from '@expo/vector-icons'
import * as Clipboard from 'expo-clipboard'
import { router } from 'expo-router'
import { useCallback, useState, type ReactElement } from 'react'
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View, type LayoutChangeEvent } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import Animated from 'react-native-reanimated'
import { Sheet } from '@/components/Sheet'
import { ErrorState, Loading } from '@/components/ui'
import { LIMITS } from '@/config/env'
import { QUICK_REACTIONS } from '@/lib/emojis'
import { isSameDay } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { useKeyboardSafeBottom } from '@/lib/safeBottom'
import { useAuth } from '@/stores/auth'
import type { ChatMessage } from '@/types/models'
import { colors, font, spacing } from '@/theme'
import { MessageItem } from './MessageItem'

/**
 * Conversation secondaire (fil de discussion, publication de forum) : messages en lecture,
 * réactions rapides, copie, et une zone de réponse texte. `messages` : du plus récent au plus ancien.
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
  onSend: (text: string) => Promise<unknown>
  header?: ReactElement
  disabledReason?: string | null
  placeholder: string
}) {
  const me = useAuth((s) => s.user)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [selected, setSelected] = useState<ChatMessage | null>(null)
  const safeBottom = useKeyboardSafeBottom(spacing.sm)
  const [topOffset, setTopOffset] = useState(0)
  const onKavLayout = useCallback((e: LayoutChangeEvent) => {
    e.target.measureInWindow((_x, y) => setTopOffset((prev) => (Math.abs(prev - y) > 0.5 ? y : prev)))
  }, [])
  const onPressAuthor = useCallback((userId: string) => router.push(`/user/${userId}`), [])

  const text = draft.trim()
  const submit = () => {
    if (!text || sending) return
    setSending(true)
    onSend(text)
      .then(() => setDraft(''))
      .catch((e) => Alert.alert('Envoi impossible', errorMessage(e)))
      .finally(() => setSending(false))
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
          <View style={styles.row}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder={placeholder}
              placeholderTextColor={colors.textFaint}
              multiline
              maxLength={LIMITS.messageMaxChars}
              accessibilityLabel="Réponse"
              textAlignVertical="center"
            />
            <Pressable
              style={[styles.send, { backgroundColor: text && !sending ? colors.primary : colors.bgHover }]}
              onPress={submit}
              disabled={!text || sending}
              accessibilityRole="button"
              accessibilityLabel="Envoyer"
              accessibilityState={{ disabled: !text || sending, busy: sending }}
            >
              {sending ? <ActivityIndicator color="#fff" /> : <Ionicons name="send" size={18} color="#fff" />}
            </Pressable>
          </View>
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
                accessibilityLabel={`Réagir ${e}`}
              >
                <Text style={{ fontSize: 24 }}>{e}</Text>
              </Pressable>
            ))}
          </View>
        }
        actions={
          selected?.content
            ? [{ label: 'Copier le texte', icon: 'copy-outline', onPress: () => void Clipboard.setStringAsync(selected.content ?? '') }]
            : []
        }
      />
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingTop: spacing.sm },
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
