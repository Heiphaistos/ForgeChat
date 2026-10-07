import { Ionicons } from '@expo/vector-icons'
import * as SecureStore from 'expo-secure-store'
import { router } from 'expo-router'
import { useState, type ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Button } from '@/components/ui'
import { useT } from '@/i18n'
import { colors, font, spacing } from '@/theme'

const KEY = 'fc_nsfw_ok'

function confirmes(): string[] {
  try {
    const v: unknown = JSON.parse(SecureStore.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Salon réservé aux adultes : confirmation d'âge une fois par salon et par appareil (comme le web). */
export function NsfwGate({ channelId, name, nsfw, children }: { channelId: string; name: string; nsfw: boolean; children: ReactNode }) {
  const t = useT()
  const [ok, setOk] = useState(() => confirmes())
  if (!nsfw || ok.includes(channelId)) return <>{children}</>
  const confirmer = () => {
    const next = [...new Set([...ok, channelId])].slice(-200)
    setOk(next)
    try {
      SecureStore.setItem(KEY, JSON.stringify(next))
    } catch {
      /* stockage indisponible : redemandé au prochain passage */
    }
  }
  return (
    <View style={styles.wrap} accessibilityRole="alert">
      <Ionicons name="warning" size={48} color={colors.danger} />
      <Text style={styles.title}>{t('server.nsfw.title')}</Text>
      <Text style={styles.body}>{t('server.nsfw.body', { name })}</Text>
      <View style={styles.row}>
        <Button title={t('server.nsfw.back')} variant="secondary" onPress={() => router.back()} />
        <Button title={t('server.nsfw.confirm')} variant="danger" onPress={confirmer} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md, backgroundColor: colors.bg },
  title: { color: colors.text, fontSize: font.xl, fontWeight: '800', textAlign: 'center' },
  body: { color: colors.textMuted, fontSize: font.md, textAlign: 'center' },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
})
