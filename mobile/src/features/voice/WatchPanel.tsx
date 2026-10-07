import { Ionicons } from '@expo/vector-icons'
import { useEffect, useState } from 'react'
import { Alert, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { Button, IconButton } from '@/components/ui'
import { WatchPlayer } from '@/components/WatchPlayer'
import { t as tr, useT } from '@/i18n'
import { formatDuration } from '@/lib/format'
import { realtime } from '@/lib/realtime'
import { useNow } from '@/lib/useNow'
import { parseYouTubeId, watchErrorMessage, watchLink, watchPosition } from '@/lib/watchTogether'
import { useWatch } from '@/stores/watch'
import { colors, font, radius, spacing } from '@/theme'

/**
 * « Regarder ensemble » dans l'écran vocal (comme client/src/components/voice/WatchTogether.tsx) :
 * rien n'est appliqué en local d'avance, on envoie la commande et l'état renvoyé par le serveur
 * (à tout le salon, nous compris) pilote le lecteur. Masquer le panneau n'arrête pas la vidéo.
 */
export function WatchPanel({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const watch = useWatch((s) => s.watch)
  const t = useT()
  const now = useNow(1000, !!watch)
  const [url, setUrl] = useState('')
  const [muted, setMuted] = useState(false)
  const [failedItem, setFailedItem] = useState<number | null>(null)
  // Musique ensemble : lecteur réduit (toujours visible, comme l'exige YouTube), commandes et file en avant.
  const [music, setMusic] = useState(false)

  useEffect(
    () =>
      realtime.on('WATCH_ERROR', (e) => {
        if (e.channel_id === channelId) Alert.alert(tr('panel.watch.title'), watchErrorMessage(e.reason))
      }),
    [channelId],
  )

  const send = (msg: Record<string, unknown>) => realtime.send({ ...msg, channel_id: channelId })
  const position = watch ? watchPosition(watch, now) : 0
  const setPlayback = (playing: boolean, pos: number) => {
    if (watch) send({ type: 'WATCH_STATE', item: watch.item, playing, position: Math.max(0, pos) })
  }
  const add = () => {
    if (!parseYouTubeId(url)) {
      Alert.alert(t('panel.watch.badUrl'), t('panel.watch.badUrlBody'))
      return
    }
    send({ type: 'WATCH_ADD', url: url.trim() })
    setUrl('')
  }
  const failed = !!watch && failedItem === watch.item

  return (
    <View style={styles.panel}>
      <View style={styles.head}>
        <Ionicons name="logo-youtube" size={16} color={colors.primary} />
        <Text style={styles.title} numberOfLines={1}>
          {watch?.queue ? t('panel.watch.titleQueue', { n: watch.queue }) : t('panel.watch.title')}
        </Text>
        {watch ? (
          <IconButton icon="open-outline" label={t('panel.watch.openYoutube')} size={18} onPress={() => void Linking.openURL(watchLink(watch, Date.now())).catch(() => undefined)} />
        ) : null}
        <IconButton icon="musical-notes" label={t('voiceLot.music.toggle')} size={18} active={music} onPress={() => setMusic((m) => !m)} />
        <IconButton icon="close" label={t('panel.watch.hide')} size={18} onPress={onClose} />
      </View>

      {watch && !failed ? (
        <View style={music ? styles.small : undefined}>
          <WatchPlayer
            watch={watch}
            muted={muted}
            onEnded={(item) => send({ type: 'WATCH_NEXT', item })}
            onFailed={setFailedItem}
          />
        </View>
      ) : (
        <View style={styles.placeholder}>
          <Text style={styles.hint}>
            {failed
              ? t('panel.watch.unplayable')
              : t('panel.watch.hint')}
          </Text>
          {failed && watch ? (
            <Button title={t('panel.watch.openYoutube')} icon="logo-youtube" variant="ghost" onPress={() => void Linking.openURL(watchLink(watch, Date.now())).catch(() => undefined)} />
          ) : null}
        </View>
      )}

      {watch ? (
        <View style={styles.row}>
          <IconButton icon={watch.playing ? 'pause' : 'play'} label={t(watch.playing ? 'panel.watch.pause' : 'panel.watch.play')} onPress={() => setPlayback(!watch.playing, position)} />
          <IconButton icon="play-back" label={t('panel.watch.back10')} onPress={() => setPlayback(watch.playing, position - 10)} />
          <IconButton icon="play-forward" label={t('panel.watch.forward10')} onPress={() => setPlayback(watch.playing, position + 10)} />
          <Text style={styles.time}>{formatDuration(position * 1000)}</Text>
          <IconButton
            icon="play-skip-forward"
            label={t(watch.queue ? 'panel.watch.next' : 'panel.watch.finish')}
            onPress={() => send({ type: 'WATCH_NEXT', item: watch.item })}
          />
          <IconButton icon="stop" label={t('panel.watch.stop')} onPress={() => send({ type: 'WATCH_STOP' })} />
          <IconButton icon={muted ? 'volume-mute' : 'volume-high'} label={t(muted ? 'panel.watch.unmute' : 'panel.watch.mute')} active={muted} onPress={() => setMuted((m) => !m)} />
        </View>
      ) : null}

      <View style={styles.row}>
        <TextInput
          value={url}
          onChangeText={setUrl}
          maxLength={300}
          placeholder={music ? 'https://music.youtube.com/watch?v=…' : 'https://www.youtube.com/watch?v=…'}
          placeholderTextColor={colors.textFaint}
          accessibilityLabel={t('panel.watch.urlA11y')}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="send"
          onSubmitEditing={add}
          style={styles.input}
        />
        <Pressable onPress={add} disabled={!url.trim()} accessibilityRole="button" style={[styles.go, !url.trim() && { opacity: 0.4 }]}>
          <Text style={styles.goText}>{t(watch ? 'panel.add' : 'panel.watch.start')}</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  panel: { margin: spacing.md, marginBottom: 0, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.bgAlt },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  title: { flex: 1, color: colors.text, fontSize: font.sm, fontWeight: '700' },
  small: { width: 200, alignSelf: 'center', borderRadius: radius.sm, overflow: 'hidden' },
  placeholder: { aspectRatio: 16 / 9, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.md },
  hint: { color: colors.textMuted, fontSize: font.sm, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  time: { color: colors.textMuted, fontSize: font.xs, fontVariant: ['tabular-nums'], marginHorizontal: spacing.xs },
  input: { flex: 1, minWidth: 0, color: colors.text, backgroundColor: colors.bgDeep, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: font.sm },
  go: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  goText: { color: '#fff', fontWeight: '700', fontSize: font.sm },
})
