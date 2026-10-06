import { useQuery } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView } from 'react-native'
import { moderationApi, type AutoMod } from '@/api/moderation'
import { Button, ErrorState, Loading, Section, SwitchRow, T, TextField } from '@/components/ui'
import { ChoiceRow } from '@/features/servers/ChoiceRow'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { colors, spacing } from '@/theme'

// La valeur actuelle reste proposée même si le web en a fixé une autre.
const counts = (max: number, current: number) =>
  [...new Set([0, 1, 2, 3, 5, 10, 20, 50, current])]
    .filter((n) => n <= max)
    .sort((a, b) => a - b)
    .map((n) => ({ value: n, label: n ? `${n} au plus` : 'Sans limite' }))

/** AutoMod (MANAGE_SERVER) : mots bloqués, limites de mentions et de liens, anti-spam, anti-majuscules. */
export default function AutoModScreen() {
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const sid = ids.serverId ?? ''
  const q = useQuery({ queryKey: ['automod', sid], queryFn: () => moderationApi.automod(sid), enabled: valid })
  if (!valid) return <ErrorState message="Serveur invalide." />
  if (q.isLoading) return <Loading />
  if (!q.data) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
  return <AutoModForm serverId={sid} initial={q.data} />
}

function AutoModForm({ serverId, initial }: { serverId: string; initial: AutoMod }) {
  const [cfg, setCfg] = useState(initial)
  const [words, setWords] = useState(initial.blocked_words.join(', '))
  const [saving, setSaving] = useState(false)
  const set = (patch: Partial<AutoMod>) => setCfg((c) => ({ ...c, ...patch }))

  const save = async () => {
    const blocked = [...new Set(words.split(/[,\n]/).map((w) => w.trim().toLowerCase()).filter(Boolean))]
    if (blocked.length > 200) return Alert.alert('Trop de mots', '200 mots bloqués au plus.')
    setSaving(true)
    try {
      await moderationApi.setAutomod(serverId, { ...cfg, blocked_words: blocked })
      Alert.alert('AutoMod enregistré')
    } catch (e) {
      Alert.alert('Enregistrement impossible', errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'AutoMod' }} />
      <Section>
        <SwitchRow icon="shield-checkmark-outline" title="Activer l'AutoMod" value={cfg.enabled} onValueChange={(v) => set({ enabled: v })} />
      </Section>
      <Section title="Règles">
        <SwitchRow icon="repeat-outline" title="Anti-spam" subtitle="Bloque les messages répétés en rafale" value={cfg.anti_spam} onValueChange={(v) => set({ anti_spam: v })} />
        <SwitchRow icon="text-outline" title="Anti-majuscules" subtitle="Bloque les messages écrits en capitales" value={cfg.anti_caps} onValueChange={(v) => set({ anti_caps: v })} />
        <ChoiceRow icon="at-outline" title="Mentions par message" value={cfg.max_mentions} options={counts(50, cfg.max_mentions)} onChange={(v) => set({ max_mentions: v })} />
        <ChoiceRow icon="link-outline" title="Liens par message" value={cfg.max_links} options={counts(20, cfg.max_links)} onChange={(v) => set({ max_links: v })} />
      </Section>
      <TextField
        label="Mots bloqués"
        value={words}
        onChangeText={setWords}
        placeholder="mot1, mot2, expression entière"
        multiline
        autoCapitalize="none"
        style={{ minHeight: 100, textAlignVertical: 'top' }}
      />
      <T variant="small">Séparés par des virgules ; un mot n’est bloqué qu’entier (« hell » ne bloque pas « hello »).</T>
      <Button title="Enregistrer" onPress={save} loading={saving} />
    </ScrollView>
  )
}
