// « Transcrire » sous un message vocal déchiffré : transcription Whisper SUR LE TÉLÉPHONE
// (moteur local, bridge.ts). Le son ne quitte jamais l'appareil.
import { useState } from 'react'
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useT } from '@/i18n'
import { decryptedBase64 } from '@/e2e/files'
import { colors, font, spacing } from '@/theme'
import { transcribeOnDevice, useAiSettings } from './actions'

export default function VoiceTranscript({ uri, mime }: { uri: string; mime: string }) {
  const t = useT()
  const enabled = useAiSettings((s) => s.transcribe)
  const [text, setText] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!enabled) return null

  const run = async () => {
    setBusy(true)
    try {
      const r = await transcribeOnDevice(decryptedBase64(uri), mime)
      if (r !== null) setText(r)
    } catch {
      Alert.alert(t('ai.title'), t('ai.transcribeFailed'))
    } finally {
      setBusy(false)
    }
  }

  if (text !== null) {
    return (
      <View style={styles.box} accessible accessibilityLabel={`${t('ai.transcript')} : ${text}`}>
        <Text style={styles.label}>{t('ai.transcript')}</Text>
        <Text style={styles.text}>{text || '…'}</Text>
      </View>
    )
  }
  return (
    <Pressable onPress={() => void run()} disabled={busy} style={styles.button} accessibilityRole="button" hitSlop={6}>
      {busy ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="document-text-outline" size={14} color={colors.textMuted} />}
      <Text style={styles.buttonText}>{busy ? t('ai.transcribing') : t('ai.transcribe')}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: spacing.xs, alignSelf: 'flex-start' },
  buttonText: { color: colors.textMuted, fontSize: font.xs },
  box: { marginTop: 4, paddingLeft: spacing.sm, borderLeftWidth: 2, borderLeftColor: colors.primary, maxWidth: 320 },
  label: { color: colors.primary, fontSize: font.xs, fontWeight: '600' },
  text: { color: colors.text, fontSize: font.sm },
})
