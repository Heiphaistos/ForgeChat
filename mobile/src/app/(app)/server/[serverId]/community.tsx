import { Stack } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView } from 'react-native'
import { communityApi } from '@/api/community'
import { ErrorState, Section, SwitchRow } from '@/components/ui'
import { LevelsPanel } from '@/features/community/LevelsPanel'
import { TicketsPanel } from '@/features/community/TicketsPanel'
import { useServerDetail, useServerPerms } from '@/features/servers/menus'
import { PERM } from '@/features/servers/perms'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { qk, queryClient } from '@/lib/queryClient'
import { colors, spacing } from '@/theme'

/** Communauté d'un serveur : niveaux et classement, tickets, verrouillage en un clic (staff). */
export default function CommunityScreen() {
  const t = useT()
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const sid = ids.serverId ?? ''
  const detail = useServerDetail(sid, valid)
  const perms = useServerPerms(sid, valid)
  const [busy, setBusy] = useState(false)
  if (!valid) return <ErrorState message={t('server.invalid')} />
  const staff = perms.has(PERM.MANAGE_MESSAGES | PERM.MANAGE_SERVER | PERM.KICK_MEMBERS)
  const locked = !!detail.data?.lockdown

  const toggleLock = async (on: boolean) => {
    setBusy(true)
    try {
      await communityApi.lockdown(sid, on)
      await queryClient.invalidateQueries({ queryKey: qk.server(sid) })
    } catch (e) {
      Alert.alert(t('common.actionFailed'), errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: t('community.menu') }} />
      {staff ? (
        <Section title={t('community.lockdown.title')} footer={t(locked ? 'community.lockdown.on' : 'community.lockdown.desc')}>
          <SwitchRow icon="lock-closed-outline" title={t('community.lockdown.enable')} value={locked} disabled={busy}
            onValueChange={(v) => void toggleLock(v)} />
        </Section>
      ) : null}
      <LevelsPanel serverId={sid} />
      <TicketsPanel serverId={sid} />
    </ScrollView>
  )
}
