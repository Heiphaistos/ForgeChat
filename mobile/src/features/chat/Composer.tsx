import { Ionicons } from '@expo/vector-icons'
import * as DocumentPicker from 'expo-document-picker'
import * as Haptics from 'expo-haptics'
import * as ImagePicker from 'expo-image-picker'
import { Image } from 'expo-image'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import Animated from 'react-native-reanimated'
import { Avatar } from '@/components/Avatar'
import { Sheet } from '@/components/Sheet'
import { LIMITS } from '@/config/env'
import { errorMessage } from '@/lib/http'
import { useKeyboardSafeBottom } from '@/lib/safeBottom'
import type { ChatMessage } from '@/types/models'
import { colors, font, radius, spacing } from '@/theme'
import { ensurePhotoAccess } from '@/lib/photoAccess'
import { restoreAfterSendError } from './sendErrors'
import { activeMentionQuery, applyMention, filterMentionCandidates, type MentionCandidate } from './mentions'
import { sanitizeFilename, validateAttachment, type LocalAttachment } from './useConversation'

const MAX_FILES = 10

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
}

interface Props {
  placeholder: string
  disabled?: boolean
  disabledReason?: string
  replyTo: ChatMessage | null
  editing: ChatMessage | null
  onCancelReply: () => void
  onCancelEdit: () => void
  onSend: (text: string, files: LocalAttachment[]) => Promise<void>
  onEdit: (id: string, text: string) => Promise<void>
  onTyping: () => void
  draft: string
  onDraftChange: (text: string) => void
  /** Personnes proposées après « @ » (vide : pas d'autocomplétion). */
  mentionCandidates?: readonly MentionCandidate[]
  myId?: string | null
}

export function Composer({
  placeholder,
  disabled,
  disabledReason,
  replyTo,
  editing,
  onCancelReply,
  onCancelEdit,
  onSend,
  onEdit,
  onTyping,
  draft,
  onDraftChange,
  mentionCandidates,
  myId = null,
}: Props) {
  const [files, setFiles] = useState<LocalAttachment[]>([])
  // Au-dessus de la barre de navigation Android, clavier fermé comme ouvert (affichage bord à bord).
  const safeBottom = useKeyboardSafeBottom(spacing.sm)
  const [sending, setSending] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const inputRef = useRef<TextInput>(null)
  // Valeurs courantes lues après un envoi asynchrone (le rendu a pu changer entre-temps).
  const draftRef = useRef(draft)
  const filesRef = useRef(files)
  useEffect(() => {
    draftRef.current = draft
    filesRef.current = files
  }, [draft, files])
  const [cursor, setCursor] = useState(0)
  /** Position imposée après une insertion de mention ; relâchée dès que le TextInput l'a appliquée. */
  const [forcedSelection, setForcedSelection] = useState<{ start: number; end: number } | undefined>(undefined)

  const mention = mentionCandidates?.length ? activeMentionQuery(draft, cursor) : null
  const suggestions = useMemo(
    () => (mention && mentionCandidates ? filterMentionCandidates(mentionCandidates, mention.query, myId) : []),
    [mention?.query, mention?.start, mentionCandidates, myId], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const pickMention = (c: MentionCandidate) => {
    if (!mention) return
    const next = applyMention(draft, mention.start, cursor, c)
    onDraftChange(next.text)
    setCursor(next.cursor)
    setForcedSelection({ start: next.cursor, end: next.cursor })
  }

  useEffect(() => {
    if (editing) {
      onDraftChange(editing.content ?? '')
      inputRef.current?.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id])

  useEffect(() => {
    if (replyTo) inputRef.current?.focus()
  }, [replyTo])

  const addFiles = (incoming: LocalAttachment[]) => {
    const accepted: LocalAttachment[] = []
    for (const f of incoming) {
      const err = validateAttachment(f)
      if (err) Alert.alert('Fichier refusé', `${f.name} : ${err}`)
      else accepted.push(f)
    }
    setFiles((prev) => [...prev, ...accepted].slice(0, MAX_FILES))
  }

  const pickImages = async (camera: boolean) => {
    const granted = camera ? (await ImagePicker.requestCameraPermissionsAsync()).granted : await ensurePhotoAccess()
    if (!granted) {
      Alert.alert('Permission refusée', camera ? 'Autorise l’accès à la caméra dans les réglages.' : 'Autorise l’accès aux photos dans les réglages.')
      return
    }
    const opts: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: !camera,
      selectionLimit: MAX_FILES,
      // Ré-encodage (qualité < 1) : supprime les métadonnées EXIF, dont la position GPS.
      quality: 0.85,
      exif: false,
      videoMaxDuration: 120,
    }
    const res = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts)
    if (res.canceled) return
    addFiles(
      res.assets.map((a, i) => {
        // L'extension RÉELLE est celle du fichier produit (ré-encodé) : on la lit sur l'URI,
        // pas sur le nom d'origine (un .HEIC devient .jpg après ré-encodage).
        const uriExt = a.uri.split('?')[0]?.split('.').pop()?.toLowerCase() ?? ''
        const ext = /^[a-z0-9]{2,5}$/.test(uriExt) ? (uriExt === 'jpeg' ? 'jpg' : uriExt) : a.type === 'video' ? 'mp4' : 'jpg'
        const base = sanitizeFilename(a.fileName ?? `media-${Date.now()}-${i}`).replace(/\.[^.]+$/, '')
        return {
          uri: a.uri,
          name: `${base}.${ext}`,
          type: MIME_BY_EXT[ext] ?? a.mimeType ?? 'application/octet-stream',
          size: a.fileSize ?? null,
        }
      }),
    )
  }

  const pickDocuments = async () => {
    const res = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true })
    if (res.canceled) return
    addFiles(
      res.assets.map((a) => ({
        uri: a.uri,
        name: sanitizeFilename(a.name),
        type: a.mimeType ?? 'application/octet-stream',
        size: a.size ?? null,
      })),
    )
  }

  const canSend = !sending && !disabled && (draft.trim().length > 0 || files.length > 0)
  const over = draft.length > LIMITS.messageMaxChars

  const submit = async () => {
    if (!canSend || over) return
    const text = draft
    setSending(true)
    try {
      if (editing) {
        await onEdit(editing.id, text)
        onCancelEdit()
        onDraftChange('')
      } else {
        const toSend = files
        onDraftChange('')
        setFiles([])
        try {
          await onSend(text, toSend)
        } catch (e) {
          // Ne rien perdre : ce qui n'est pas parti revient dans le composer.
          const back = restoreAfterSendError(e, { text, files: toSend }, { text: draftRef.current, files: filesRef.current })
          onDraftChange(back.text)
          setFiles(back.files)
          throw e
        }
      }
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    } catch (e) {
      Alert.alert('Envoi impossible', errorMessage(e))
    } finally {
      setSending(false)
    }
  }

  if (disabled) {
    return (
      <Animated.View style={[styles.container, { alignItems: 'center', paddingTop: spacing.lg }, safeBottom]}>
        <Text style={{ color: colors.textMuted }}>{disabledReason ?? 'Tu ne peux pas écrire ici.'}</Text>
      </Animated.View>
    )
  }

  return (
    <Animated.View style={[styles.container, safeBottom]}>
      {replyTo || editing ? (
        <View style={styles.contextBar}>
          <Ionicons name={editing ? 'create-outline' : 'arrow-undo'} size={16} color={colors.textMuted} />
          <Text style={styles.contextText} numberOfLines={1}>
            {editing ? 'Modification du message' : `Réponse à ${replyTo?.authorName}`}
          </Text>
          <Pressable
            onPress={() => {
              if (editing) {
                onCancelEdit()
                onDraftChange('')
              } else onCancelReply()
            }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Annuler"
          >
            <Ionicons name="close-circle" size={20} color={colors.textMuted} />
          </Pressable>
        </View>
      ) : null}

      {files.length ? (
        <ScrollView horizontal style={styles.files} contentContainerStyle={{ gap: spacing.sm, padding: spacing.sm }}>
          {files.map((f, i) => (
            <View key={`${f.uri}-${i}`} style={styles.fileChip}>
              {f.type.startsWith('image/') ? (
                <Image source={{ uri: f.uri }} style={styles.thumb} contentFit="cover" />
              ) : (
                <View style={[styles.thumb, { alignItems: 'center', justifyContent: 'center' }]}>
                  <Ionicons name="document-outline" size={26} color={colors.textMuted} />
                </View>
              )}
              <Text style={styles.fileChipName} numberOfLines={1}>
                {f.name}
              </Text>
              <Pressable
                style={styles.removeFile}
                onPress={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                accessibilityRole="button"
                accessibilityLabel={`Retirer ${f.name}`}
                hitSlop={8}
              >
                <Ionicons name="close" size={14} color="#fff" />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}

      {suggestions.length ? (
        <ScrollView style={styles.mentions} keyboardShouldPersistTaps="always" accessibilityLabel="Suggestions de mention">
          {suggestions.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => pickMention(c)}
              style={({ pressed }) => [styles.mentionRow, pressed && { backgroundColor: colors.bgHover }]}
              accessibilityRole="button"
              accessibilityLabel={`Mentionner ${c.username}`}
            >
              <Avatar uri={c.avatar} name={c.username} size={24} userId={c.id} />
              <Text style={styles.mentionName} numberOfLines={1}>
                {c.nickname ?? c.username}
              </Text>
              {c.nickname ? (
                <Text style={styles.mentionUser} numberOfLines={1}>
                  {c.username}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.row}>
        {!editing ? (
          <Pressable style={styles.attach} onPress={() => setPickerOpen(true)} accessibilityRole="button" accessibilityLabel="Joindre un fichier" hitSlop={6}>
            <Ionicons name="add" size={24} color={colors.textSecondary} />
          </Pressable>
        ) : null}
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={draft}
          onChangeText={(t) => {
            onDraftChange(t)
            if (t.length) onTyping()
          }}
          selection={forcedSelection}
          onSelectionChange={(e) => {
            setCursor(e.nativeEvent.selection.end)
            if (forcedSelection) setForcedSelection(undefined)
          }}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          multiline
          maxLength={LIMITS.messageMaxChars + 200}
          accessibilityLabel="Message"
          textAlignVertical="center"
        />
        <Pressable
          style={[styles.send, { backgroundColor: canSend && !over ? colors.primary : colors.bgHover }]}
          onPress={submit}
          disabled={!canSend || over}
          accessibilityRole="button"
          accessibilityLabel={editing ? 'Enregistrer' : 'Envoyer'}
        >
          <Ionicons name={editing ? 'checkmark' : 'send'} size={18} color="#fff" />
        </Pressable>
      </View>
      {draft.length > LIMITS.messageMaxChars - 300 ? (
        <Text style={[styles.counter, over && { color: colors.danger }]}>
          {draft.length}/{LIMITS.messageMaxChars}
        </Text>
      ) : null}

      <Sheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Joindre"
        actions={[
          { label: 'Photos et vidéos', icon: 'images-outline', onPress: () => void pickImages(false) },
          { label: 'Prendre une photo', icon: 'camera-outline', onPress: () => void pickImages(true) },
          { label: 'Fichier', icon: 'document-outline', onPress: () => void pickDocuments() },
        ]}
      />
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingBottom: spacing.sm },
  contextBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bgAlt,
  },
  contextText: { flex: 1, color: colors.textMuted, fontSize: font.sm },
  files: { maxHeight: 120 },
  fileChip: { width: 90, gap: 4 },
  fileChipName: { color: colors.textMuted, fontSize: font.xs },
  thumb: { width: 90, height: 70, borderRadius: radius.sm, backgroundColor: colors.bgElevated },
  removeFile: { position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 10, padding: 2 },
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
  mentions: { maxHeight: 200, marginHorizontal: spacing.sm, marginTop: spacing.sm, borderRadius: radius.md, backgroundColor: colors.bgAlt },
  mentionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  mentionName: { color: colors.text, fontSize: font.md, fontWeight: '600', flexShrink: 1 },
  mentionUser: { color: colors.textMuted, fontSize: font.sm, flexShrink: 1 },
  counter: { alignSelf: 'flex-end', marginRight: spacing.lg, color: colors.textMuted, fontSize: font.xs, marginTop: 2 },
})
