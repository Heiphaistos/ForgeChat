import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'
import { forumApi } from '@/api/forum'
import { Button, ErrorState, IconButton, TextField } from '@/components/ui'
import { createPostBody, MAX_TAGS, normalizeTag, toggleTag } from '@/features/forum/forum'
import { TagChips } from '@/features/forum/TagChips'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { qk, queryClient } from '@/lib/queryClient'
import { colors, font, spacing } from '@/theme'

/** Nouvelle publication (comme CreatePostModal) : titre, texte facultatif, 5 tags au plus. */
export default function NewPostScreen() {
  const { valid, ids } = useRouteParams(['serverId', 'channelId'] as const)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [busy, setBusy] = useState(false)
  // Tags officiels : s'il y en a, le serveur n'accepte qu'eux → simple choix parmi la liste.
  const official = useQuery({ queryKey: qk.forumTags(ids.channelId ?? ''), queryFn: () => forumApi.tags(ids.channelId), enabled: valid })
  if (!valid) return <ErrorState message="Lien de salon invalide." />
  const officialTags = official.data ?? []

  const body = createPostBody(title, content, tags)
  const submit = () => {
    if (!body) return
    setBusy(true)
    forumApi
      .create(ids.serverId, ids.channelId, body)
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: qk.forum(ids.channelId) })
        router.back()
      })
      .catch((e) => Alert.alert('Publication impossible', errorMessage(e)))
      .finally(() => setBusy(false))
  }
  const addTag = () => {
    setTags((t) => (t.includes(normalizeTag(tagInput)) ? t : toggleTag(t, tagInput)))
    setTagInput('')
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }} keyboardShouldPersistTaps="handled">
      <TextField label="Titre" accessibilityLabel="Titre de la publication" value={title} onChangeText={setTitle} maxLength={200} />
      <TextField
        label="Message (facultatif)"
        accessibilityLabel="Message de la publication, facultatif"
        value={content}
        onChangeText={setContent}
        multiline
        maxLength={8000}
        style={{ minHeight: 120, textAlignVertical: 'top' }}
      />
      <Text style={styles.label}>
        Tags ({tags.length}/{MAX_TAGS})
      </Text>
      {officialTags.length ? (
        <TagChips tags={officialTags} selected={tags} onToggle={(t) => setTags((cur) => toggleTag(cur, t))} />
      ) : (
        <>
          <View style={styles.tagRow}>
            <View style={{ flex: 1 }}>
              <TextField
                accessibilityLabel="Nouveau tag"
                placeholder="Ajouter un tag"
                value={tagInput}
                onChangeText={setTagInput}
                onSubmitEditing={addTag}
                autoCapitalize="none"
                maxLength={30}
              />
            </View>
            <IconButton icon="add" label="Ajouter le tag" onPress={addTag} disabled={!tagInput.trim() || tags.length >= MAX_TAGS} />
          </View>
          <TagChips tags={tags} selected={tags} onToggle={(t) => setTags((cur) => toggleTag(cur, t))} />
        </>
      )}
      <Button title="Publier" icon="send" loading={busy} disabled={!body} onPress={submit} />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  label: { color: colors.textMuted, fontSize: font.sm, fontWeight: '600' },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
})
