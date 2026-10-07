import { Ionicons } from '@expo/vector-icons'
import * as SecureStore from 'expo-secure-store'
import { router } from 'expo-router'
import { useState, type ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Button } from '@/components/ui'
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
      <Text style={styles.title}>Salon réservé aux adultes</Text>
      <Text style={styles.body}>
        « {name} » peut contenir du contenu réservé aux plus de 18 ans. Confirme que tu es majeur et que tu acceptes de voir ce contenu.
      </Text>
      <View style={styles.row}>
        <Button title="Non, retour" variant="secondary" onPress={() => router.back()} />
        <Button title="J’ai plus de 18 ans" variant="danger" onPress={confirmer} />
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
