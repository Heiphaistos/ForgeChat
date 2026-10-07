import { Ionicons } from '@expo/vector-icons'
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from 'expo-audio'
import { useEffect, useRef, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { t as tr, useT } from '@/i18n'
import { logger } from '@/lib/logger'
import { useCall } from '@/stores/call'
import { useVoice } from '@/stores/voice'
import { colors, font, spacing } from '@/theme'
import { formatDuration } from '@/features/chat/media'
import { VOICE_MAX_SECONDS } from './formats'

/** AAC mono 64 kb/s dans un conteneur MP4 (voir formats.voiceFileName). */
const VOICE_OPTIONS: RecordingOptions = { ...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, bitRate: 64_000 }

/** Un appel ou un salon vocal utilise déjà le micro : pas d'enregistrement en même temps. */
export function micBusy(): boolean {
  return useCall.getState().phase !== 'idle' || !!useVoice.getState().channelId
}

/**
 * Demande la permission micro (seulement maintenant, au premier enregistrement) ; false si refusée
 * ou si le micro est occupé par un appel.
 */
export async function prepareVoiceRecording(): Promise<boolean> {
  if (micBusy()) {
    Alert.alert(tr('panel.rec.micBusy'), tr('panel.rec.micBusyBody'))
    return false
  }
  const perm = await requestRecordingPermissionsAsync()
  if (!perm.granted) {
    Alert.alert(tr('panel.rec.micDenied'), tr('panel.rec.micDeniedBody'))
    return false
  }
  return true
}

/**
 * Barre d'enregistrement (remplace la zone de saisie) : durée, annuler, envoyer. S'arrête seule à
 * VOICE_MAX_SECONDS. Monter ce composant démarre l'enregistrement ; `onDone(null)` = annulé.
 */
export function VoiceRecorder({ onDone }: { onDone: (result: { uri: string; seconds: number } | null) => void }) {
  const recorder = useAudioRecorder(VOICE_OPTIONS)
  const state = useAudioRecorderState(recorder, 250)
  const [ready, setReady] = useState(false)
  const finished = useRef(false)
  const t = useT()
  const seconds = Math.floor(state.durationMillis / 1000)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
        await recorder.prepareToRecordAsync()
        if (cancelled) return
        recorder.record()
        setReady(true)
      } catch (e) {
        logger.warn('voice-message', 'enregistrement impossible', e)
        Alert.alert(t('panel.rec.failed'), t('panel.rec.failedBody'))
        onDone(null)
      }
    })()
    return () => {
      cancelled = true
      // Démonté sans fin explicite (écran quitté) : on coupe le micro, rien n'est envoyé.
      if (!finished.current) void recorder.stop().catch(() => undefined)
      void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const finish = async (send: boolean) => {
    if (finished.current) return
    finished.current = true
    const duration = state.durationMillis / 1000
    try {
      await recorder.stop()
    } catch (e) {
      logger.debug('voice-message', 'arrêt', e)
    }
    const uri = recorder.uri
    if (!send || !uri || duration < 1) {
      if (send && duration < 1) Alert.alert(t('panel.rec.tooShort'), t('panel.rec.tooShortBody'))
      onDone(null)
      return
    }
    onDone({ uri, seconds: Math.min(duration, VOICE_MAX_SECONDS) })
  }

  // Durée maximale atteinte : on arrête (l'utilisateur choisit ensuite d'envoyer ou non).
  const autoStopped = useRef(false)
  useEffect(() => {
    if (ready && seconds >= VOICE_MAX_SECONDS && !autoStopped.current) {
      autoStopped.current = true
      void finish(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds, ready])

  return (
    <View style={styles.bar} accessibilityLiveRegion="polite">
      <Pressable onPress={() => void finish(false)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('panel.rec.cancel')}>
        <Ionicons name="trash-outline" size={22} color={colors.danger} />
      </Pressable>
      <View style={styles.middle}>
        <View style={[styles.dot, !state.isRecording && { opacity: 0.3 }]} />
        <Text style={styles.time} accessibilityLabel={t('panel.rec.time', { n: seconds })}>
          {formatDuration(seconds)} / {formatDuration(VOICE_MAX_SECONDS)}
        </Text>
      </View>
      <Pressable
        onPress={() => void finish(true)}
        disabled={!ready}
        style={[styles.send, !ready && { opacity: 0.4 }]}
        accessibilityRole="button"
        accessibilityLabel={t('panel.rec.send')}
      >
        <Ionicons name="send" size={18} color="#fff" />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 40, paddingHorizontal: spacing.sm },
  middle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger },
  time: { color: colors.text, fontSize: font.md, fontVariant: ['tabular-nums'] },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
})
