import { useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'
import { forumApi } from '@/api/forum'
import { e2eErrorText } from '@/e2e/conversations'
import { Button, ErrorState, IconButton, TextField } from '@/components/ui'
import { createPostBody, isVideoMedia, mediaExtension, MAX_TAGS, normalizeTag, toggleTag } from '@/features/forum/forum'
import { TagChips } from '@/features/forum/TagChips'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { SignedImage } from '@/components/SignedImage'
import { ensurePhotoAccess } from '@/lib/photoAccess'
import { useRouteParams } from '@/lib/params'
import { qk, queryClient } from '@/lib/queryClient'
import { colors, font, spacing } from '@/theme'

/** Nouvelle publication (comme CreatePostModal) : titre, texte facultatif, 5 tags au plus. Salon média : image ou vidéo obligatoire. */
export default function NewPostScreen() {
  const t = useT()
  const { valid, ids, text } = useRouteParams(['serverId', 'channelId'] as const, ['media'])
  const media = text.media === '1'
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  // Aperçu local du média choisi (un média chiffré n'est pas lisible depuis le serveur).
  const [localUri, setLocalUri] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [busy, setBusy] = useState(false)
  // Tags officiels : s'il y en a, le serveur n'accepte qu'eux → simple choix parmi la liste.
  const official = useQuery({ queryKey: qk.forumTags(ids.channelId ?? ''), queryFn: () => forumApi.tags(ids.channelId), enabled: valid })
  if (!valid) return <ErrorState message={t('conv.invalidChannel')} />
  const officialTags = official.data ?? []

  const body = media && !mediaUrl ? null : createPostBody(title, content, tags, mediaUrl)
  const pickMedia = async () => {
    if (!(await ensurePhotoAccess())) return
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'] })
    const a = res.canceled ? undefined : res.assets[0]
    if (!a) return
    const ext = mediaExtension(a.mimeType)
    if (!ext) return Alert.alert(t('social.newPost.badFormat'), t('social.newPost.formats'))
    setUploading(true)
    try {
      setMediaUrl(await forumApi.uploadMedia(ids.serverId, ids.channelId, { uri: a.uri, name: `media.${ext}`, type: a.mimeType ?? '', size: a.fileSize ?? null }))
      setLocalUri(a.uri)
    } catch (e) {
      Alert.alert(t('composer.sendFailed'), e2eErrorText(e) ?? errorMessage(e))
    } finally {
      setUploading(false)
    }
  }
  const submit = () => {
    if (!body) return
    setBusy(true)
    forumApi
      .create(ids.serverId, ids.channelId, body)
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: qk.forum(ids.channelId) })
        router.back()
      })
      .catch((e) => Alert.alert(t('chat.publishFailed'), e2eErrorText(e) ?? errorMessage(e)))
      .finally(() => setBusy(false))
  }
  const addTag = () => {
    setTags((t) => (t.includes(normalizeTag(tagInput)) ? t : toggleTag(t, tagInput)))
    setTagInput('')
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }} keyboardShouldPersistTaps="handled">
      {media ? (
        <>
          {mediaUrl && !isVideoMedia(mediaUrl) ? (
            localUri ? (
              <Image source={{ uri: localUri }} style={styles.preview} contentFit="contain" accessibilityLabel={t('social.newPost.chosenMedia')} />
            ) : (
              <SignedImage url={mediaUrl} style={styles.preview} contentFit="contain" accessibilityLabel={t('social.newPost.chosenMedia')} />
            )
          ) : mediaUrl ? (
            <Text style={styles.label}>{t('social.newPost.videoReady')}</Text>
          ) : null}
          <Button title={mediaUrl ? t('social.newPost.changeMedia') : t('social.newPost.pickMedia')} variant="secondary" icon="images-outline" loading={uploading} onPress={() => void pickMedia()} />
        </>
      ) : null}
      <TextField label={media ? t('social.newPost.caption') : t('social.newPost.title')} accessibilityLabel={media ? t('social.newPost.captionLabel') : t('social.newPost.titleLabel')} value={title} onChangeText={setTitle} maxLength={200} />
      <TextField
        label={t('social.newPost.message')}
        accessibilityLabel={t('social.newPost.messageLabel')}
        value={content}
        onChangeText={setContent}
        multiline
        maxLength={8000}
        style={{ minHeight: 120, textAlignVertical: 'top' }}
      />
      <Text style={styles.label}>
        {t('social.newPost.tags', { n: tags.length, max: MAX_TAGS })}
      </Text>
      {officialTags.length ? (
        <TagChips tags={officialTags} selected={tags} onToggle={(t) => setTags((cur) => toggleTag(cur, t))} />
      ) : (
        <>
          <View style={styles.tagRow}>
            <View style={{ flex: 1 }}>
              <TextField
                accessibilityLabel={t('social.newPost.newTag')}
                placeholder={t('social.newPost.addTagPlaceholder')}
                value={tagInput}
                onChangeText={setTagInput}
                onSubmitEditing={addTag}
                autoCapitalize="none"
                maxLength={30}
              />
            </View>
            <IconButton icon="add" label={t('social.newPost.addTag')} onPress={addTag} disabled={!tagInput.trim() || tags.length >= MAX_TAGS} />
          </View>
          <TagChips tags={tags} selected={tags} onToggle={(t) => setTags((cur) => toggleTag(cur, t))} />
        </>
      )}
      <Button title={t('social.newPost.publish')} icon="send" loading={busy} disabled={!body} onPress={submit} />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  label: { color: colors.textMuted, fontSize: font.sm, fontWeight: '600' },
  preview: { width: '100%', aspectRatio: 1, backgroundColor: '#000', borderRadius: 8 },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
})
