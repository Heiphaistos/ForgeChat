import { Ionicons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { ScrollView, View } from 'react-native'
import { onboardingApi, type OnboardingQuestion } from '@/api/onboarding'
import { Button, ErrorState, Loading, Row, Section, T } from '@/components/ui'
import { errorMessage } from '@/lib/http'
import { qk, queryClient } from '@/lib/queryClient'
import { colors, spacing } from '@/theme'
import type { Role } from '@/types/models'
import { useServerDetail } from './menus'
import { PERM } from './perms'

// Mêmes droits que `SAFE_PERMS` (onboarding.rs) : un rôle d'accueil ne modère ni n'administre.
const SAFE = [PERM.VIEW_CHANNEL, PERM.SEND_MESSAGES, PERM.READ_HISTORY, PERM.ATTACH_FILES, PERM.EMBED_LINKS, PERM.ADD_REACTIONS, PERM.CONNECT_VOICE, PERM.SPEAK_VOICE, PERM.STREAM]
  .reduce((acc, b) => acc | BigInt(b), 0n)
/** Rôle proposable dans l'onboarding (le serveur refuse les autres). */
export const onboardingRoleAllowed = (r: Role) => !r.is_everyone && (BigInt(Math.trunc(r.permissions)) & ~SAFE) === 0n

export const onboardingKey = (serverId: string) => ['onboarding', serverId] as const

/** Choix unique : cocher une réponse décoche les autres de la même question. */
export function toggleChoice(selected: string[], q: OnboardingQuestion, optionId: string): string[] {
  if (selected.includes(optionId)) return selected.filter((id) => id !== optionId)
  const others = q.multiple ? selected : selected.filter((id) => !q.options.some((o) => o.id === id))
  return [...others, optionId]
}

/** Questions d'accueil d'un serveur (même écran que le web, OnboardingModal.tsx). */
export function OnboardingForm({ serverId, skippable, onDone }: { serverId: string; skippable?: boolean; onDone?: () => void }) {
  const q = useQuery({ queryKey: onboardingKey(serverId), queryFn: () => onboardingApi.get(serverId) })
  const [selected, setSelected] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
  const current = selected ?? q.data?.selected ?? []

  const save = async (ids: string[]) => {
    setBusy(true)
    setError(null)
    try {
      await onboardingApi.answer(serverId, ids)
      // Rôles et salons visibles changent : liste des salons comprise.
      await Promise.all([onboardingKey(serverId), qk.server(serverId), qk.channels(serverId)].map((queryKey) => queryClient.invalidateQueries({ queryKey })))
      onDone?.()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}>
      <View style={{ alignItems: 'center', gap: spacing.sm }}>
        <Ionicons name="sparkles-outline" size={48} color={colors.primary} />
        <T variant="subtitle" style={{ textAlign: 'center' }}>
          Bienvenue !
        </T>
        <T variant="muted" style={{ textAlign: 'center' }}>
          Réponds à quelques questions pour obtenir les rôles et salons qui te concernent.
        </T>
      </View>
      {(q.data?.questions ?? []).map((question) => (
        <Section key={question.id} title={question.title} footer={question.multiple ? 'Plusieurs choix possibles' : 'Un seul choix'}>
          {question.options.map((o) => (
            <Row
              key={o.id}
              title={o.label}
              selected={current.includes(o.id!)}
              right={current.includes(o.id!) ? <Ionicons name="checkmark-circle" size={20} color={colors.primary} /> : null}
              onPress={() => setSelected(toggleChoice(current, question, o.id!))}
            />
          ))}
        </Section>
      ))}
      {error ? <T variant="error">{error}</T> : null}
      <Button title="Valider" onPress={() => void save(current)} loading={busy} />
      {skippable ? <Button title="Passer" variant="secondary" onPress={() => void save([])} disabled={busy} /> : null}
    </ScrollView>
  )
}

/** Après la barrière de vérification : questions d'accueil tant que le membre n'y a pas répondu. */
export function OnboardingGate({ serverId, children }: { serverId: string; children: ReactNode }) {
  const detail = useServerDetail(serverId)
  if (!detail.data?.member?.onboarding_pending) return children
  return <OnboardingForm serverId={serverId} skippable />
}
