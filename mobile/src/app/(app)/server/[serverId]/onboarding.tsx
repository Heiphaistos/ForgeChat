import { router } from 'expo-router'
import { ErrorState } from '@/components/ui'
import { OnboardingForm } from '@/features/servers/Onboarding'
import { useT } from '@/i18n'
import { useRouteParams } from '@/lib/params'

/** Modifier ses réponses aux questions d'accueil (menu du serveur). */
export default function OnboardingAnswersScreen() {
  const t = useT()
  const { valid, ids } = useRouteParams(['serverId'] as const)
  if (!valid) return <ErrorState message={t('server.invalid')} />
  return <OnboardingForm serverId={ids.serverId} onDone={() => router.back()} />
}
