import { router } from 'expo-router'
import { ErrorState } from '@/components/ui'
import { OnboardingForm } from '@/features/servers/Onboarding'
import { useRouteParams } from '@/lib/params'

/** Modifier ses réponses aux questions d'accueil (menu du serveur). */
export default function OnboardingAnswersScreen() {
  const { valid, ids } = useRouteParams(['serverId'] as const)
  if (!valid) return <ErrorState message="Serveur invalide." />
  return <OnboardingForm serverId={ids.serverId} onDone={() => router.back()} />
}
