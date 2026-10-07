import { ErrorState } from '@/components/ui'
import { ServerKeySettings } from '@/e2e/ServerKeySettings'
import { useT } from '@/i18n'
import { useRouteParams } from '@/lib/params'

/** Paramètres du serveur > Chiffrement : clé de récupération du serveur (propriétaire). */
export default function ServerEncryptionScreen() {
  const t = useT()
  const { valid, ids } = useRouteParams(['serverId'] as const)
  if (!valid) return <ErrorState message={t('serverSettings.invalidServer')} />
  return <ServerKeySettings serverId={ids.serverId} />
}
