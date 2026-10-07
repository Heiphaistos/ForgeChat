import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Alert, Pressable, ScrollView, Text, View } from 'react-native'
import { onboardingApi, type OnboardingOption, type OnboardingQuestion } from '@/api/onboarding'
import { Button, ErrorState, IconButton, Loading, Section, SwitchRow, T, TextField } from '@/components/ui'
import { useServerDetail } from '@/features/servers/menus'
import { onboardingKey, onboardingRoleAllowed } from '@/features/servers/Onboarding'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { qk, queryClient } from '@/lib/queryClient'
import { colors, font, radius, spacing } from '@/theme'

const flip = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
const emptyOption = (): OnboardingOption => ({ label: '', role_ids: [], channel_ids: [] })

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      style={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : 'transparent' }}
    >
      <Text style={{ color: on ? '#fff' : colors.textMuted, fontSize: font.sm }}>{label}</Text>
    </Pressable>
  )
}

/** Accueil des nouveaux membres (propriétaire) : questions, réponses, rôles et salons donnés (web : OnboardingTab.tsx). */
export default function OnboardingSettingsScreen() {
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const sid = ids.serverId ?? ''
  const q = useQuery({ queryKey: onboardingKey(sid), queryFn: () => onboardingApi.get(sid), enabled: valid })
  if (!valid) return <ErrorState message="Serveur invalide." />
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
  return <Editor serverId={sid} initial={q.data?.questions ?? []} />
}

function Editor({ serverId, initial }: { serverId: string; initial: OnboardingQuestion[] }) {
  const detail = useServerDetail(serverId)
  const [draft, setDraft] = useState(initial)
  const [busy, setBusy] = useState(false)
  const roles = (detail.data?.roles ?? []).filter(onboardingRoleAllowed)
  const channels = detail.data?.channels ?? []
  const setQ = (qi: number, patch: Partial<OnboardingQuestion>) => setDraft((d) => d.map((x, i) => (i === qi ? { ...x, ...patch } : x)))
  const setO = (qi: number, oi: number, patch: Partial<OnboardingOption>) =>
    setQ(qi, { options: draft[qi]!.options.map((o, i) => (i === oi ? { ...o, ...patch } : o)) })

  const save = async () => {
    setBusy(true)
    try {
      await onboardingApi.save(serverId, draft)
      await Promise.all([onboardingKey(serverId), qk.server(serverId)].map((queryKey) => queryClient.invalidateQueries({ queryKey })))
      Alert.alert('Accueil enregistré')
    } catch (e) {
      Alert.alert('Enregistrement impossible', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }} keyboardShouldPersistTaps="handled">
      <T variant="muted">
        Questions posées à l’arrivée, après la vérification. Chaque réponse peut donner des rôles (sans droit de modération) et rendre visibles des salons.
      </T>
      {draft.map((question, qi) => (
        <Section key={question.id ?? `n${qi}`} title={`Question ${qi + 1}`}>
          <View style={{ padding: spacing.md, gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <TextField value={question.title} onChangeText={(title) => setQ(qi, { title })} placeholder="Question" accessibilityLabel="Question" maxLength={100} />
              </View>
              <IconButton icon="trash-outline" label="Supprimer la question" color={colors.danger} onPress={() => setDraft((d) => d.filter((_, i) => i !== qi))} />
            </View>
            <SwitchRow title="Plusieurs choix" value={question.multiple} onValueChange={(multiple) => setQ(qi, { multiple })} />
            {question.options.map((o, oi) => (
              <View key={o.id ?? `n${oi}`} style={{ gap: spacing.xs, paddingLeft: spacing.sm, borderLeftWidth: 2, borderLeftColor: colors.border }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <TextField value={o.label} onChangeText={(label) => setO(qi, oi, { label })} placeholder="Réponse" accessibilityLabel="Réponse" maxLength={100} />
                  </View>
                  <IconButton icon="close" label="Supprimer la réponse" onPress={() => setQ(qi, { options: question.options.filter((_, i) => i !== oi) })} />
                </View>
                {roles.length ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                    {roles.map((r) => <Chip key={r.id} label={`@${r.name}`} on={o.role_ids.includes(r.id)} onPress={() => setO(qi, oi, { role_ids: flip(o.role_ids, r.id) })} />)}
                  </View>
                ) : null}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                  {channels.map((c) => <Chip key={c.id} label={`#${c.name}`} on={o.channel_ids.includes(c.id)} onPress={() => setO(qi, oi, { channel_ids: flip(o.channel_ids, c.id) })} />)}
                </View>
              </View>
            ))}
            {question.options.length < 10 ? (
              <Button title="Ajouter une réponse" variant="ghost" icon="add" onPress={() => setQ(qi, { options: [...question.options, emptyOption()] })} />
            ) : null}
          </View>
        </Section>
      ))}
      {draft.length < 10 ? (
        <Button title="Ajouter une question" variant="secondary" icon="add" onPress={() => setDraft((d) => [...d, { title: '', multiple: false, options: [emptyOption()] }])} />
      ) : null}
      <Button title="Enregistrer" onPress={() => void save()} loading={busy} />
    </ScrollView>
  )
}
