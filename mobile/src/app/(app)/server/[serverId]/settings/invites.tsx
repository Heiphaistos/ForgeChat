import { useQuery } from '@tanstack/react-query'
import * as Clipboard from 'expo-clipboard'
import { router, useFocusEffect } from 'expo-router'
import { useCallback } from 'react'
import { Alert, FlatList } from 'react-native'
import { serversApi } from '@/api/servers'
import { Button, EmptyState, ErrorState, IconButton, Loading, Row } from '@/components/ui'
import { apiOrigin } from '@/config/env'
import { formatShort } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import type { Invite } from '@/types/models'
import { colors, spacing } from '@/theme'
import { useAppearance } from '@/theme/prefs'

/** Invitations actives (MANAGE_SERVER) : copier, révoquer, en créer une. */
export default function InvitesScreen() {
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const streamer = useAppearance((st) => st.streamerMode)
  const sid = ids.serverId ?? ''
  const invites = useQuery({ queryKey: ['invites', sid], queryFn: () => serversApi.invites(sid), enabled: valid })
  // Retour de l'écran de création : afficher la nouvelle invitation.
  const { refetch } = invites
  useFocusEffect(
    useCallback(() => {
      if (valid) void refetch()
    }, [valid, refetch]),
  )
  if (!valid) return <ErrorState message="Serveur invalide." />
  if (invites.isLoading) return <Loading />
  if (invites.error) return <ErrorState message={errorMessage(invites.error)} onRetry={() => void invites.refetch()} />

  const revoke = (inv: Invite) =>
    Alert.alert(`Révoquer ${inv.code} ?`, 'Le lien cessera de fonctionner.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Révoquer',
        style: 'destructive',
        onPress: () =>
          void serversApi
            .deleteInvite(sid, inv.code)
            .then(() => invites.refetch())
            .catch((e) => Alert.alert('Action impossible', errorMessage(e))),
      },
    ])

  const subtitle = (i: Invite) =>
    [`${i.uses}${i.max_uses ? `/${i.max_uses}` : ''} utilisation${i.uses > 1 ? 's' : ''}`, i.expires_at ? `expire le ${formatShort(i.expires_at)}` : 'sans expiration'].join(' · ')

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      data={invites.data ?? []}
      keyExtractor={(i) => i.code}
      ListHeaderComponent={
        <Button title="Créer une invitation" icon="add" onPress={() => router.push(`/server/${sid}/invite`)} style={{ margin: spacing.lg }} />
      }
      ListEmptyComponent={<EmptyState icon="link-outline" title="Aucune invitation active" />}
      renderItem={({ item }) => (
        <Row
          icon="link-outline"
          title={streamer ? '••••••' : item.code}
          subtitle={subtitle(item)}
          right={
            <>
              <IconButton icon="copy-outline" label={`Copier le lien ${item.code}`} onPress={() => void Clipboard.setStringAsync(`${apiOrigin()}/invite/${item.code}`)} />
              <IconButton icon="trash-outline" label={`Révoquer ${item.code}`} color={colors.danger} onPress={() => revoke(item)} />
            </>
          }
        />
      )}
    />
  )
}
