import { useMutation, useQuery } from '@tanstack/react-query'
import * as DocumentPicker from 'expo-document-picker'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { soundboardApi, SOUND_EXTS, SOUND_MAX_BYTES, type Sound } from '@/api/soundboard'
import { Sheet } from '@/components/Sheet'
import { Button, Loading } from '@/components/ui'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { queryClient } from '@/lib/queryClient'
import { useVoice } from '@/stores/voice'
import { colors, font, radius, spacing } from '@/theme'

const MIME: Record<string, string> = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', webm: 'audio/webm', m4a: 'audio/mp4' }

/** Soundboard du salon vocal : sons du serveur puis ceux de mes autres serveurs (comme le web). */
export function SoundboardSheet({ serverId, canManage, visible, onClose }: { serverId: string; canManage: boolean; visible: boolean; onClose: () => void }) {
  const playSound = useVoice((s) => s.playSound)
  const t = useT()
  const sounds = useQuery({ queryKey: ['soundboard', serverId], queryFn: () => soundboardApi.list(serverId), enabled: visible })
  const mine = useQuery({ queryKey: ['my_soundboard'], queryFn: soundboardApi.mine, enabled: visible, staleTime: 60_000 })
  const others = (mine.data ?? []).filter((s) => s.server_id !== serverId)
  const otherServers = [...new Set(others.map((s) => s.server_id))]

  const upload = useMutation({
    mutationFn: async () => {
      const res = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true, multiple: false })
      const a = res.canceled ? null : res.assets[0]
      if (!a) return null
      const ext = a.name.split('.').pop()?.toLowerCase() ?? ''
      if (!(SOUND_EXTS as readonly string[]).includes(ext)) throw new Error(t('panel.sound.badFormat', { exts: SOUND_EXTS.join(', ') }))
      if (a.size != null && a.size > SOUND_MAX_BYTES) throw new Error(t('panel.sound.tooBig'))
      const name = a.name.replace(/\.[^.]+$/, '').trim().slice(0, 32) || 'Son'
      const type = a.mimeType?.startsWith('audio/') ? a.mimeType : MIME[ext]!
      return soundboardApi.upload(serverId, name, { uri: a.uri, name: a.name, type })
    },
    onSuccess: (sound) => {
      if (!sound) return
      void queryClient.invalidateQueries({ queryKey: ['soundboard', serverId] })
      void queryClient.invalidateQueries({ queryKey: ['my_soundboard'] })
      Alert.alert(t('panel.sound.added'), t('panel.sound.addedBody', { name: sound.name }))
    },
    onError: (e) => Alert.alert(t('panel.sound.addFailed'), errorMessage(e)),
  })

  const grid = (list: Sound[]) => (
    <View style={styles.grid}>
      {list.map((s) => (
        <Pressable
          key={s.id}
          onPress={() => playSound(s.id, s.file_url)}
          style={({ pressed }) => [styles.sound, pressed && { backgroundColor: colors.primary }]}
          accessibilityRole="button"
          accessibilityLabel={t('panel.sound.play', { name: s.name })}
        >
          <Text style={styles.emoji}>{s.emoji || '🎵'}</Text>
          <Text style={styles.name} numberOfLines={1}>
            {s.name}
          </Text>
        </Pressable>
      ))}
    </View>
  )

  const body = sounds.isLoading ? (
    <Loading />
  ) : sounds.isError ? (
    <Text style={styles.muted}>{t('panel.sound.loadFailed', { error: errorMessage(sounds.error) })}</Text>
  ) : (
    <>
      {sounds.data?.length ? grid(sounds.data) : <Text style={styles.muted}>{t('panel.sound.empty')}</Text>}
      {otherServers.map((sid) => {
        const list = others.filter((s) => s.server_id === sid)
        return (
          <View key={sid}>
            <Text style={styles.section}>{list[0]!.server_name}</Text>
            {grid(list)}
          </View>
        )
      })}
    </>
  )

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t('panel.sound.title')}
      actions={[]}
      header={
        <View style={styles.body}>
          <ScrollView style={{ maxHeight: 360 }}>{body}</ScrollView>
          {canManage ? (
            <Button title={t('panel.sound.add')} icon="add" variant="ghost" loading={upload.isPending} onPress={() => upload.mutate()} />
          ) : null}
        </View>
      }
    />
  )
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  sound: {
    width: '31%',
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.bgElevated,
  },
  emoji: { fontSize: 22 },
  name: { color: colors.text, fontSize: font.xs, fontWeight: '600', maxWidth: '100%' },
  section: { color: colors.textMuted, fontSize: font.xs, fontWeight: '700', marginTop: spacing.md, marginBottom: spacing.xs, textTransform: 'uppercase' },
  muted: { color: colors.textMuted, fontSize: font.sm, paddingVertical: spacing.md, textAlign: 'center' },
})
