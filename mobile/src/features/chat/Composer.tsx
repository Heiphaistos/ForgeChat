import { Ionicons } from '@expo/vector-icons'
import * as DocumentPicker from 'expo-document-picker'
import * as Haptics from 'expo-haptics'
import * as ImagePicker from 'expo-image-picker'
import { Image } from 'expo-image'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import Animated from 'react-native-reanimated'
import { Avatar } from '@/components/Avatar'
import { Sheet } from '@/components/Sheet'
import type { IconName } from '@/components/ui'
import { messagesApi } from '@/api/messages'
import { PollCreator, ScheduleSheet } from '@/features/composer/ChannelExtras'
import { activeSlashQuery, BUILTIN_COMMANDS, COMMANDS_WITH_ARGS, runBuiltin, type SlashCommand } from '@/features/composer/commands'
import { useServerDetail } from '@/features/servers/menus'
import { MESSAGE_TTL_OPTIONS } from '@/features/composer/data'
import { voiceFileName, voiceMessageContent } from '@/features/composer/formats'
import { EmojiPanel, GifPanel, QuickRepliesPanel, StickerPanel, useGifSearchAvailable } from '@/features/composer/Panels'
import { prepareVoiceRecording, VoiceRecorder } from '@/features/composer/VoiceRecorder'
import { LIMITS } from '@/config/env'
import { useUxPrefs } from '@/stores/uxPrefs'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { useKeyboardSafeBottom } from '@/lib/safeBottom'
import type { ChatMessage } from '@/types/models'
import { colors, font, outline, radius, spacing } from '@/theme'
import { ensurePhotoAccess } from '@/lib/photoAccess'
import { useCustomEmojis } from './customEmojis'
import { restoreAfterSendError } from './sendErrors'
import {
  activeMentionQuery,
  activeTriggerQuery,
  applyMention,
  encodeMentions,
  filterChannels,
  filterMentionCandidates,
  filterRoles,
  replaceQuery,
  specialMentions,
  type MentionCandidate,
} from './mentions'
import { roleColor } from './tokens'
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
  /** `replyPing` : réponse dans un salon, notifier l'auteur cité (false = sans mention). */
  onSend: (text: string, files: LocalAttachment[], opts?: { expiresInSeconds?: number | null; replyPing?: boolean }) => Promise<void>
  onEdit: (id: string, text: string) => Promise<void>
  onTyping: () => void
  draft: string
  onDraftChange: (text: string) => void
  /** Personnes proposées après « @ » (vide : pas d'autocomplétion). */
  mentionCandidates?: readonly MentionCandidate[]
  myId?: string | null
  /** Salon d'un serveur : stickers du serveur et messages éphémères (le serveur ne les gère qu'ici). */
  serverId?: string
  /** Salon courant : sondages et messages programmés. */
  channelId?: string
}

/** Ligne d'autocomplétion : membre, rôle, @everyone, salon ou commande « / ». */
interface Suggestion {
  key: string
  label: string
  sub?: string
  icon?: IconName
  color?: string | null
  user?: MentionCandidate
  pick: () => void
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
  serverId,
  channelId,
}: Props) {
  const t = useT()
  const [files, setFiles] = useState<LocalAttachment[]>([])
  // Au-dessus de la barre de navigation Android, clavier fermé comme ouvert (affichage bord à bord).
  const safeBottom = useKeyboardSafeBottom(spacing.sm)
  const [sending, setSending] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [panel, setPanel] = useState<'emoji' | 'gif' | 'sticker' | 'quick' | 'ttl' | 'more' | 'poll' | 'schedule' | null>(null)
  const gifSearch = useGifSearchAvailable()
  const [ttl, setTtl] = useState<number | null>(null)
  // Réponse : mention de l'auteur cité (réglage par défaut, modifiable pour chaque réponse avec @ON/@OFF).
  const pingDefault = useUxPrefs((s) => s.replyPing)
  const [pingFor, setPingFor] = useState<{ id: string; on: boolean } | null>(null)
  const replyPing = replyTo && pingFor?.id === replyTo.id ? pingFor.on : pingDefault
  const [recording, setRecording] = useState(false)
  const customEmojis = useCustomEmojis()
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

  // Rôles et salons du serveur (GET /servers/:id, déjà en cache pour l'en-tête du salon) ; commandes des bots.
  const detail = useServerDetail(serverId ?? '', !!serverId)
  const botCommands = useQuery({
    queryKey: ['server-commands', serverId],
    queryFn: () => messagesApi.commands(serverId!),
    enabled: !!serverId,
    staleTime: 60_000,
  })
  /** `@rôle` affiché dans la saisie → jeton <@&id> envoyé (comme pickedMentions du web). */
  const picked = useRef(new Map<string, string>())

  const applyText = (next: { text: string; cursor: number }) => {
    onDraftChange(next.text)
    setCursor(next.cursor)
    setForcedSelection({ start: next.cursor, end: next.cursor })
  }

  const slash = editing ? null : activeSlashQuery(draft)
  const mention = slash === null && (mentionCandidates?.length || serverId) ? activeMentionQuery(draft, cursor) : null
  const channelQuery = slash === null && !mention && serverId ? activeTriggerQuery(draft, cursor, '#') : null
  const suggestions = useMemo<Suggestion[]>(() => {
    if (slash !== null) {
      const all: SlashCommand[] = [...BUILTIN_COMMANDS, ...(serverId ? (botCommands.data ?? []) : [])]
      return all
        .filter((c) => c.name.startsWith(slash))
        .slice(0, 8)
        .map((c) => ({
          key: `/${c.name}`,
          label: `/${c.name}`,
          sub: c.bot ? `${c.bot} · ${c.description}` : c.description,
          icon: c.bot ? 'hardware-chip-outline' : 'flash-outline',
          pick: () => pickCommand(c),
        }))
    }
    if (mention) {
      const users: Suggestion[] = filterMentionCandidates(mentionCandidates ?? [], mention.query, myId).map((c) => ({
        key: `u${c.id}`,
        label: c.nickname ?? c.username,
        sub: c.nickname ? c.username : undefined,
        user: c,
        pick: () => applyText(applyMention(draft, mention.start, cursor, c)),
      }))
      if (!serverId) return users
      const roles: Suggestion[] = filterRoles(detail.data?.roles ?? [], mention.query).map((r) => ({
        key: `r${r.id}`,
        label: `@${r.name}`,
        sub: t('composer.role'),
        icon: 'shield-outline',
        color: roleColor(r.color),
        pick: () => {
          picked.current.set(r.name, `<@&${r.id}>`)
          applyText(replaceQuery(draft, mention.start, cursor, `@${r.name}`))
        },
      }))
      const specials: Suggestion[] = specialMentions(mention.query).map((n) => ({
        key: n,
        label: `@${n}`,
        sub: t(n === 'everyone' ? 'composer.everyone' : 'composer.here'),
        icon: 'megaphone-outline',
        pick: () => applyText(replaceQuery(draft, mention.start, cursor, `@${n}`)),
      }))
      return [...users, ...roles, ...specials]
    }
    if (channelQuery) {
      return filterChannels(detail.data?.channels ?? [], channelQuery.query).map((c) => ({
        key: `c${c.id}`,
        label: `#${c.name}`,
        icon: c.type === 'voice' ? 'volume-medium-outline' : 'chatbubble-outline',
        pick: () => applyText(replaceQuery(draft, channelQuery.start, cursor, `#${c.name}`)),
      }))
    }
    return []
  }, [slash, mention?.start, mention?.query, channelQuery?.start, channelQuery?.query, draft, cursor, mentionCandidates, myId, serverId, detail.data, botCommands.data]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Commande choisie : celles qui attendent un texte (et celles des bots) restent dans la saisie, les autres partent. */
  const pickCommand = (c: SlashCommand) => {
    if (c.bot || COMMANDS_WITH_ARGS.has(c.name)) {
      applyText({ text: `/${c.name} `, cursor: c.name.length + 2 })
      return
    }
    const result = runBuiltin(`/${c.name}`)
    if (result && 'send' in result) {
      onDraftChange('')
      void sendDirect(result.send)
    }
  }

  /** Texte final : jetons des rôles choisis (salons). */
  const encode = (text: string) => (serverId ? encodeMentions(text, picked.current) : text)

  /** Insère un texte à la position du curseur (emoji, réponse rapide), comme le web. */
  const insertText = (text: string) => {
    const at = Math.min(cursor, draft.length)
    const next = draft.slice(0, at) + text + draft.slice(at)
    if (next.length > LIMITS.messageMaxChars + 200) return
    onDraftChange(next)
    setCursor(at + text.length)
    setForcedSelection({ start: at + text.length, end: at + text.length })
  }

  /** Envoi direct d'un contenu (sticker, message vocal), sans toucher au brouillon. */
  const sendDirect = async (text: string, attached: LocalAttachment[] = []) => {
    setSending(true)
    try {
      await onSend(text, attached, { expiresInSeconds: serverId ? ttl : null, replyPing })
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    } catch (e) {
      Alert.alert(t('composer.sendFailed'), errorMessage(e))
    } finally {
      setSending(false)
    }
  }

  const startRecording = async () => {
    if (await prepareVoiceRecording()) setRecording(true)
  }

  const onRecorded = (result: { uri: string; seconds: number } | null) => {
    setRecording(false)
    if (!result) return
    void sendDirect(voiceMessageContent(result.seconds), [{ uri: result.uri, name: voiceFileName(), type: 'video/mp4', size: null }])
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
      if (err) Alert.alert(t('composer.fileRejected'), `${f.name} : ${err}`)
      else accepted.push(f)
    }
    setFiles((prev) => [...prev, ...accepted].slice(0, MAX_FILES))
  }

  const pickImages = async (camera: boolean) => {
    const granted = camera ? (await ImagePicker.requestCameraPermissionsAsync()).granted : await ensurePhotoAccess()
    if (!granted) {
      Alert.alert(t('composer.permissionDenied'), t(camera ? 'composer.allowCamera' : 'composer.allowPhotos'))
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
        // Commande intégrée (« /shrug », « /me … ») : remplacée par son texte, comme le web.
        const builtin = toSend.length ? null : runBuiltin(text)
        if (builtin && 'gif' in builtin) {
          onDraftChange('')
          setPanel('gif')
          return
        }
        const out = builtin ? builtin.send : encode(text)
        onDraftChange('')
        setFiles([])
        picked.current.clear()
        try {
          await onSend(out, toSend, { expiresInSeconds: serverId ? ttl : null, replyPing })
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
      Alert.alert(t('composer.sendFailed'), errorMessage(e))
    } finally {
      setSending(false)
    }
  }

  const ttlOption = MESSAGE_TTL_OPTIONS.find((o) => o.seconds === ttl)

  if (disabled) {
    return (
      <Animated.View style={[styles.container, { alignItems: 'center', paddingTop: spacing.lg }, safeBottom]}>
        <Text style={{ color: colors.textMuted }}>{disabledReason ?? t('composer.cannotWrite')}</Text>
      </Animated.View>
    )
  }

  return (
    <Animated.View style={[styles.container, safeBottom]}>
      {replyTo || editing ? (
        <View style={styles.contextBar}>
          <Ionicons name={editing ? 'create-outline' : 'arrow-undo'} size={16} color={colors.textMuted} />
          <Text style={styles.contextText} numberOfLines={1}>
            {editing ? t('composer.editing') : t('composer.replyingTo', { name: replyTo?.authorName ?? '' })}
          </Text>
          {replyTo && !editing && serverId ? (
            <Pressable
              onPress={() => setPingFor({ id: replyTo.id, on: !replyPing })}
              hitSlop={8}
              accessibilityRole="switch"
              accessibilityState={{ checked: replyPing }}
              accessibilityLabel={t(replyPing ? 'ux.reply.pingOn' : 'ux.reply.pingOff')}
            >
              <Text style={{ color: replyPing ? colors.primary : colors.textMuted, fontWeight: '700', textDecorationLine: replyPing ? 'none' : 'line-through' }}>
                @{replyPing ? 'ON' : 'OFF'}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => {
              if (editing) {
                onCancelEdit()
                onDraftChange('')
              } else onCancelReply()
            }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('composer.cancel')}
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
                accessibilityLabel={t('composer.remove', { name: f.name })}
                hitSlop={8}
              >
                <Ionicons name="close" size={14} color="#fff" />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}

      {suggestions.length ? (
        <ScrollView style={styles.mentions} keyboardShouldPersistTaps="always" accessibilityLabel={t('composer.suggestions')}>
          {suggestions.map((c) => (
            <Pressable
              key={c.key}
              onPress={c.pick}
              style={({ pressed }) => [styles.mentionRow, pressed && { backgroundColor: colors.bgHover }]}
              accessibilityRole="button"
              accessibilityLabel={[c.label, c.sub].filter(Boolean).join(', ')}
            >
              {c.user ? (
                <Avatar uri={c.user.avatar} name={c.user.username} size={24} userId={c.user.id} />
              ) : (
                <Ionicons name={c.icon ?? 'at'} size={20} color={c.color ?? colors.textMuted} />
              )}
              <Text style={[styles.mentionName, c.color ? { color: c.color } : null]} numberOfLines={1}>
                {c.label}
              </Text>
              {c.sub ? (
                <Text style={styles.mentionUser} numberOfLines={1}>
                  {c.sub}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {!editing && !recording ? (
        <View style={styles.toolbar}>
          <ToolButton icon="happy-outline" label={t('composer.emoji')} onPress={() => setPanel('emoji')} />
          <Pressable onPress={() => setPanel('gif')} style={styles.tool} hitSlop={4} accessibilityRole="button" accessibilityLabel="GIF">
            <Text style={styles.gifLabel}>GIF</Text>
          </Pressable>
          <ToolButton icon="sparkles-outline" label={t('composer.stickers')} onPress={() => setPanel('sticker')} />
          <ToolButton icon="flash-outline" label={t('composer.quickReplies')} onPress={() => setPanel('quick')} />
          {serverId ? (
            <ToolButton
              icon="timer-outline"
              label={ttlOption ? t('composer.ephemeralValue', { value: t(ttlOption.label) }) : t('composer.ephemeral')}
              active={!!ttl}
              onPress={() => setPanel('ttl')}
            />
          ) : null}
          {serverId && channelId ? <ToolButton icon="ellipsis-horizontal-circle-outline" label={t('composer.more')} onPress={() => setPanel('more')} /> : null}
          {ttl && serverId ? (
            <Text style={styles.ttlLabel} numberOfLines={1}>
              ⏱ {ttlOption ? t(ttlOption.label) : null}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.row}>
        {recording ? <VoiceRecorder onDone={onRecorded} /> : null}
        {!recording && !editing ? (
          <Pressable style={styles.attach} onPress={() => setPickerOpen(true)} accessibilityRole="button" accessibilityLabel={t('composer.attach')} hitSlop={6}>
            <Ionicons name="add" size={24} color={colors.textSecondary} />
          </Pressable>
        ) : null}
        {recording ? null : (
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
          accessibilityLabel={t('composer.message')}
          textAlignVertical="center"
        />
        )}
        {recording ? null : !editing && !sending && draft.trim().length === 0 && files.length === 0 ? (
          <Pressable
            style={[styles.send, { backgroundColor: colors.bgElevated }]}
            onPress={() => void startRecording()}
            accessibilityRole="button"
            accessibilityLabel={t('composer.recordVoice')}
          >
            <Ionicons name="mic" size={20} color={colors.textSecondary} />
          </Pressable>
        ) : (
          <Pressable
            style={[styles.send, { backgroundColor: canSend && !over ? colors.primary : colors.bgHover }]}
            onPress={submit}
            disabled={!canSend || over}
            accessibilityRole="button"
            accessibilityLabel={t(editing ? 'composer.save' : 'composer.send')}
          >
            <Ionicons name={editing ? 'checkmark' : 'send'} size={18} color="#fff" />
          </Pressable>
        )}
      </View>
      {draft.length > LIMITS.messageMaxChars - 300 ? (
        <Text style={[styles.counter, over && { color: colors.danger }]}>
          {draft.length}/{LIMITS.messageMaxChars}
        </Text>
      ) : null}

      <EmojiPanel visible={panel === 'emoji'} onClose={() => setPanel(null)} onPick={insertText} customEmojis={customEmojis} />
      <GifPanel
        // Recréé quand on apprend que la recherche existe : elle devient alors l'onglet par défaut.
        key={gifSearch ? 'recherche' : 'sans-recherche'}
        visible={panel === 'gif'}
        onClose={() => setPanel(null)}
        onSendContent={(c) => void sendDirect(c)}
        onSendFile={(f) => void sendDirect('', [f])}
        serverId={serverId}
        searchAvailable={gifSearch}
      />
      <StickerPanel visible={panel === 'sticker'} onClose={() => setPanel(null)} onSend={(c) => void sendDirect(c)} serverId={serverId} />
      <QuickRepliesPanel visible={panel === 'quick'} onClose={() => setPanel(null)} onPick={insertText} />
      <Sheet
        visible={panel === 'ttl'}
        onClose={() => setPanel(null)}
        title={t('composer.expiry')}
        actions={MESSAGE_TTL_OPTIONS.map((o) => ({
          label: t(o.label),
          icon: o.seconds ? 'timer-outline' : 'infinite-outline',
          selected: ttl === o.seconds,
          onPress: () => setTtl(o.seconds),
        }))}
      />

      {serverId && channelId ? (
        <>
          <Sheet
            visible={panel === 'more'}
            onClose={() => setPanel(null)}
            actions={[
              { label: t('composer.createPoll'), icon: 'stats-chart-outline', onPress: () => setPanel('poll') },
              {
                label: t(draft.trim() ? 'composer.scheduleThis' : 'composer.scheduled'),
                icon: 'calendar-outline',
                onPress: () => setPanel('schedule'),
              },
            ]}
          />
          <PollCreator visible={panel === 'poll'} onClose={() => setPanel(null)} serverId={serverId} channelId={channelId} />
          <ScheduleSheet
            visible={panel === 'schedule'}
            onClose={() => setPanel(null)}
            serverId={serverId}
            channelId={channelId}
            content={draft}
            prepare={encode}
            onScheduled={() => {
              onDraftChange('')
              picked.current.clear()
              setPanel(null)
              Alert.alert(t('composer.scheduledDone'), t('composer.scheduledBody'))
            }}
          />
        </>
      ) : null}

      <Sheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={t('composer.attachTitle')}
        actions={[
          { label: t('composer.photos'), icon: 'images-outline', onPress: () => void pickImages(false) },
          { label: t('composer.takePhoto'), icon: 'camera-outline', onPress: () => void pickImages(true) },
          { label: t('composer.file'), icon: 'document-outline', onPress: () => void pickDocuments() },
        ]}
      />
    </Animated.View>
  )
}

function ToolButton({ icon, label, onPress, active }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable onPress={onPress} style={styles.tool} hitSlop={4} accessibilityRole="button" accessibilityLabel={label} accessibilityState={active ? { selected: true } : undefined}>
      <Ionicons name={icon} size={22} color={active ? colors.primary : colors.textMuted} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingTop: spacing.xs },
  tool: { width: 36, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  gifLabel: { color: colors.textMuted, fontSize: 13, fontWeight: '800', borderWidth: 1.5, borderColor: colors.textMuted, borderRadius: 4, paddingHorizontal: 3 },
  ttlLabel: { color: colors.primary, fontSize: font.xs, marginLeft: spacing.xs, flexShrink: 1 },
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
  attach: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.bgElevated, alignItems: 'center', justifyContent: 'center', ...outline },
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
    ...outline,
  },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  mentions: { maxHeight: 200, marginHorizontal: spacing.sm, marginTop: spacing.sm, borderRadius: radius.md, backgroundColor: colors.bgAlt },
  mentionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  mentionName: { color: colors.text, fontSize: font.md, fontWeight: '600', flexShrink: 1 },
  mentionUser: { color: colors.textMuted, fontSize: font.sm, flexShrink: 1 },
  counter: { alignSelf: 'flex-end', marginRight: spacing.lg, color: colors.textMuted, fontSize: font.xs, marginTop: 2 },
})
