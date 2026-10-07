import { Ionicons } from '@expo/vector-icons'
import { useEffect, useState } from 'react'
import { Alert, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { Button, IconButton } from '@/components/ui'
import { WatchPlayer } from '@/components/WatchPlayer'
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
  const now = useNow(1000, !!watch)
  const [url, setUrl] = useState('')
  const [muted, setMuted] = useState(false)
  const [failedItem, setFailedItem] = useState<number | null>(null)

  useEffect(
    () =>
      realtime.on('WATCH_ERROR', (e) => {
        if (e.channel_id === channelId) Alert.alert('Regarder ensemble', watchErrorMessage(e.reason))
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
      Alert.alert('Adresse YouTube invalide', 'youtube.com/watch?v=…, youtu.be/… ou youtube.com/shorts/…')
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
          Regarder ensemble{watch?.queue ? ` · ${watch.queue} en file` : ''}
        </Text>
        {watch ? (
          <IconButton icon="open-outline" label="Ouvrir dans YouTube" size={18} onPress={() => void Linking.openURL(watchLink(watch, Date.now())).catch(() => undefined)} />
        ) : null}
        <IconButton icon="close" label="Masquer le lecteur (la vidéo continue pour les autres)" size={18} onPress={onClose} />
      </View>

      {watch && !failed ? (
        <WatchPlayer
          watch={watch}
          muted={muted}
          onEnded={(item) => send({ type: 'WATCH_NEXT', item })}
          onFailed={setFailedItem}
        />
      ) : (
        <View style={styles.placeholder}>
          <Text style={styles.hint}>
            {failed
              ? 'Cette vidéo ne peut pas être lue ici (intégration désactivée, privée ou supprimée).'
              : 'Colle une adresse YouTube : la vidéo démarre pour tout le salon.'}
          </Text>
          {failed && watch ? (
            <Button title="Ouvrir dans YouTube" icon="logo-youtube" variant="ghost" onPress={() => void Linking.openURL(watchLink(watch, Date.now())).catch(() => undefined)} />
          ) : null}
        </View>
      )}

      {watch ? (
        <View style={styles.row}>
          <IconButton icon={watch.playing ? 'pause' : 'play'} label={watch.playing ? 'Pause' : 'Lecture'} onPress={() => setPlayback(!watch.playing, position)} />
          <IconButton icon="play-back" label="Reculer de 10 secondes" onPress={() => setPlayback(watch.playing, position - 10)} />
          <IconButton icon="play-forward" label="Avancer de 10 secondes" onPress={() => setPlayback(watch.playing, position + 10)} />
          <Text style={styles.time}>{formatDuration(position * 1000)}</Text>
          <IconButton
            icon="play-skip-forward"
            label={watch.queue ? 'Vidéo suivante' : 'Terminer (file vide)'}
            onPress={() => send({ type: 'WATCH_NEXT', item: watch.item })}
          />
          <IconButton icon="stop" label="Arrêter pour tout le monde" onPress={() => send({ type: 'WATCH_STOP' })} />
          <IconButton icon={muted ? 'volume-mute' : 'volume-high'} label={muted ? 'Remettre le son de la vidéo' : 'Couper le son de la vidéo (pour toi seulement)'} active={muted} onPress={() => setMuted((m) => !m)} />
        </View>
      ) : null}

      <View style={styles.row}>
        <TextInput
          value={url}
          onChangeText={setUrl}
          maxLength={300}
          placeholder="https://www.youtube.com/watch?v=…"
          placeholderTextColor={colors.textFaint}
          accessibilityLabel="Adresse de la vidéo YouTube"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="send"
          onSubmitEditing={add}
          style={styles.input}
        />
        <Pressable onPress={add} disabled={!url.trim()} accessibilityRole="button" style={[styles.go, !url.trim() && { opacity: 0.4 }]}>
          <Text style={styles.goText}>{watch ? 'Ajouter' : 'Lancer'}</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  panel: { margin: spacing.md, marginBottom: 0, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.bgAlt },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  title: { flex: 1, color: colors.text, fontSize: font.sm, fontWeight: '700' },
  placeholder: { aspectRatio: 16 / 9, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.md },
  hint: { color: colors.textMuted, fontSize: font.sm, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  time: { color: colors.textMuted, fontSize: font.xs, fontVariant: ['tabular-nums'], marginHorizontal: spacing.xs },
  input: { flex: 1, minWidth: 0, color: colors.text, backgroundColor: colors.bgDeep, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: font.sm },
  go: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  goText: { color: '#fff', fontWeight: '700', fontSize: font.sm },
})
