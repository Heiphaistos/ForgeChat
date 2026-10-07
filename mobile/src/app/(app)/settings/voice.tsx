import { Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { Stack } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView } from 'react-native'
import { Row, Section, SwitchRow } from '@/components/ui'
import { useT, type Key } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { fxSupported, importBackground } from '@/services/voiceFx'
import { useVoiceFx, type CameraBackground, type NoiseLevel } from '@/stores/voiceFx'
import { colors, spacing } from '@/theme'

const NOISE: { v: NoiseLevel; title: Key; sub: Key }[] = [
  { v: 'off', title: 'voiceLot.noise.off', sub: 'voiceLot.noise.offSub' },
  { v: 'standard', title: 'voiceLot.noise.standard', sub: 'voiceLot.noise.standardSub' },
  { v: 'strong', title: 'voiceLot.noise.strong', sub: 'voiceLot.noise.strongSub' },
]

const BACKGROUNDS: { v: CameraBackground; title: Key }[] = [
  { v: 'none', title: 'voiceLot.bg.none' },
  { v: 'blur', title: 'voiceLot.bg.blur' },
  { v: 'image', title: 'voiceLot.bg.image' },
]

/** Réglages « Voix et vidéo » de cet appareil : traitements faits sur le téléphone, avant le chiffrement. */
export default function VoiceSettingsScreen() {
  const t = useT()
  const fx = useVoiceFx()
  const [picking, setPicking] = useState(false)
  const check = (on: boolean) => (on ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null)

  const pickImage = async () => {
    setPicking(true)
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 })
      const a = res.canceled ? undefined : res.assets[0]
      if (!a) return
      const path = await importBackground(a.uri)
      fx.set({ background: 'image', backgroundImage: path })
    } catch (e) {
      Alert.alert(t('voiceLot.bg.error'), errorMessage(e))
    } finally {
      setPicking(false)
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }}>
      <Stack.Screen options={{ title: t('voiceLot.title') }} />
      <Section title={t('voiceLot.noise.title')} footer={t('voiceLot.noise.footer')}>
        {NOISE.filter((o) => o.v !== 'strong' || fxSupported.gate).map((o) => (
          <Row key={o.v} title={t(o.title)} subtitle={t(o.sub)} selected={fx.noise === o.v} onPress={() => fx.set({ noise: o.v })} right={check(fx.noise === o.v)} />
        ))}
      </Section>

      {fxSupported.background ? (
        <Section title={t('voiceLot.bg.title')} footer={t('voiceLot.bg.footer')}>
          {BACKGROUNDS.map((o) => (
            <Row
              key={o.v}
              title={t(o.title)}
              selected={fx.background === o.v}
              onPress={() => (o.v === 'image' && !fx.backgroundImage ? void pickImage() : fx.set({ background: o.v }))}
              right={check(fx.background === o.v)}
            />
          ))}
          <Row icon="image-outline" title={t(picking ? 'voiceLot.bg.picking' : 'voiceLot.bg.pick')} onPress={picking ? undefined : () => void pickImage()} chevron />
        </Section>
      ) : null}

      {fxSupported.volumePtt ? (
        <Section footer={t('voiceLot.ptt.footer')}>
          <SwitchRow icon="volume-low-outline" title={t('voiceLot.ptt.title')} value={fx.volumePtt} onValueChange={(v) => fx.set({ volumePtt: v })} />
        </Section>
      ) : null}

      <Section title={t('voiceLot.spatial.title')} footer={t('voiceLot.spatial.mobile')}>
        <Row icon="headset-outline" title={t('voiceLot.spatial.webOnly')} />
      </Section>
    </ScrollView>
  )
}
