// En-tête d'un salon : cadenas « salon chiffré » (ou invitation à créer sa clé),
// complément des clés du salon et rechiffrement de son ancien contenu à l'ouverture
// et, pour le propriétaire, rechiffrement de tout le serveur en arrière-plan et
// invitation à créer la clé de récupération du serveur (une fois par session).
import { router } from 'expo-router'
import { useEffect } from 'react'
import { Alert } from 'react-native'
import { IconButton } from '@/components/ui'
import { useServerDetail } from '@/features/servers/menus'
import { t as tr, useT } from '@/i18n'
import { getMyId } from '@/stores/auth'
import { colors } from '@/theme'
import { useAccountKey } from './accountKey'
import { completeChannelKeys, reencryptServer } from './conversations'
import { getServerKey } from './serverKey'

/** Serveurs pour lesquels l'invitation a déjà été montrée (mémoire de session). */
const prompted = new Set<string>()

export function ChannelLock({ serverId, channelId }: { serverId: string; channelId: string }) {
  const t = useT()
  const ready = useAccountKey((st) => st.status === 'ready')
  const ownerId = useServerDetail(serverId).data?.server.owner_id

  // Membres arrivés depuis l'époque courante, enveloppes de la clé du serveur manquantes.
  useEffect(() => {
    if (ready) void completeChannelKeys(channelId)
  }, [ready, channelId])

  useEffect(() => {
    if (!ready || !ownerId || ownerId !== getMyId()) return
    void reencryptServer(serverId)
    if (prompted.has(serverId)) return
    prompted.add(serverId)
    getServerKey(serverId)
      .then((k) => {
        if (k.exists) return
        Alert.alert(tr('e2e.serverKey.title'), tr('e2e.serverKey.prompt'), [
          { text: tr('e2e.serverKey.later'), style: 'cancel' },
          { text: tr('e2e.serverKey.create'), onPress: () => router.push(`/server/${serverId}/settings/encryption` as never) },
        ])
      })
      .catch(() => prompted.delete(serverId)) // hors ligne : on réessaiera à la prochaine ouverture
  }, [ready, ownerId, serverId])

  return (
    <IconButton
      icon={ready ? 'lock-closed' : 'lock-open-outline'}
      color={ready ? colors.success : colors.textSecondary}
      label={t(ready ? 'e2e.channel.encrypted' : 'e2e.channel.noKey')}
      onPress={() =>
        ready
          ? Alert.alert(tr('e2e.channel.encrypted'), tr('e2e.channel.desc'))
          : Alert.alert(tr('e2e.conv.title'), tr('e2e.channel.noKey'))
      }
    />
  )
}
