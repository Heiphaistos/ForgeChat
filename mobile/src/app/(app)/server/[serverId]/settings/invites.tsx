import { useQuery } from '@tanstack/react-query'
import * as Clipboard from 'expo-clipboard'
import { router, useFocusEffect } from 'expo-router'
import { useCallback } from 'react'
import { Alert, FlatList } from 'react-native'
import { serversApi } from '@/api/servers'
import { Button, EmptyState, ErrorState, IconButton, Loading, Row } from '@/components/ui'
import { apiOrigin } from '@/config/env'
import { useT } from '@/i18n'
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
  const t = useT()
  const invites = useQuery({ queryKey: ['invites', sid], queryFn: () => serversApi.invites(sid), enabled: valid })
  // Retour de l'écran de création : afficher la nouvelle invitation.
  const { refetch } = invites
  useFocusEffect(
    useCallback(() => {
      if (valid) void refetch()
    }, [valid, refetch]),
  )
  if (!valid) return <ErrorState message={t('serverSettings.invalidServer')} />
  if (invites.isLoading) return <Loading />
  if (invites.error) return <ErrorState message={errorMessage(invites.error)} onRetry={() => void invites.refetch()} />

  const revoke = (inv: Invite) =>
    Alert.alert(t('serverSettings.invites.revokeTitle', { code: inv.code }), t('serverSettings.invites.revokeBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('serverSettings.invites.revoke'),
        style: 'destructive',
        onPress: () =>
          void serversApi
            .deleteInvite(sid, inv.code)
            .then(() => invites.refetch())
            .catch((e) => Alert.alert(t('common.actionFailed'), errorMessage(e))),
      },
    ])

  const subtitle = (i: Invite) =>
    [
      t(i.uses > 1 ? 'serverSettings.invites.uses' : 'serverSettings.invites.use', { n: `${i.uses}${i.max_uses ? `/${i.max_uses}` : ''}` }),
      i.expires_at ? t('serverSettings.invites.expires', { date: formatShort(i.expires_at) }) : t('serverSettings.invites.noExpiry'),
    ].join(' · ')

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      data={invites.data ?? []}
      keyExtractor={(i) => i.code}
      ListHeaderComponent={
        <Button title={t('serverSettings.invites.create')} icon="add" onPress={() => router.push(`/server/${sid}/invite`)} style={{ margin: spacing.lg }} />
      }
      ListEmptyComponent={<EmptyState icon="link-outline" title={t('serverSettings.invites.empty')} />}
      renderItem={({ item }) => (
        <Row
          icon="link-outline"
          title={streamer ? '••••••' : item.code}
          subtitle={subtitle(item)}
          right={
            <>
              <IconButton icon="copy-outline" label={t('serverSettings.invites.copyLink', { code: item.code })} onPress={() => void Clipboard.setStringAsync(`${apiOrigin()}/invite/${item.code}`)} />
              <IconButton icon="trash-outline" label={t('serverSettings.invites.revokeA11y', { code: item.code })} color={colors.danger} onPress={() => revoke(item)} />
            </>
          }
        />
      )}
    />
  )
}
