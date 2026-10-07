import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView, View } from 'react-native'
import { serversApi } from '@/api/servers'
import { Button, ErrorState, IconButton, Loading, Row, Section, TextField } from '@/components/ui'
import { useServerDetail, useServerPerms } from '@/features/servers/menus'
import { roleColorHex } from '@/features/servers/perms'
import { reorderRoleIds } from '@/features/servers/reorder'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { qk, queryClient } from '@/lib/queryClient'
import { colors, spacing } from '@/theme'

/** Rôles du serveur, du plus haut au plus bas ; un nouveau rôle arrive juste au-dessus de @everyone. */
export default function RolesScreen() {
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const sid = ids.serverId ?? ''
  const detail = useServerDetail(sid, valid)
  const perms = useServerPerms(sid, valid)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const t = useT()
  if (!valid) return <ErrorState message={t('serverSettings.invalidServer')} />
  if (detail.isLoading) return <Loading />
  if (!detail.data) return <ErrorState message={errorMessage(detail.error)} onRetry={() => void detail.refetch()} />

  const create = async () => {
    if (!name.trim()) return setError(t('serverSettings.roles.nameRequired'))
    setCreating(true)
    setError(null)
    try {
      const role = await serversApi.createRole(sid, name)
      setName('')
      await queryClient.invalidateQueries({ queryKey: qk.server(sid) })
      router.push({ pathname: '/server/[serverId]/settings/role/[roleId]', params: { serverId: sid, roleId: role.id } })
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setCreating(false)
    }
  }

  const move = (roleId: string, delta: -1 | 1) => {
    const order = reorderRoleIds(detail.data?.roles ?? [], roleId, delta, perms.roleBelow)
    if (!order) return
    void serversApi
      .reorderRoles(sid, order)
      .then(() => queryClient.invalidateQueries({ queryKey: qk.server(sid) }))
      .catch((e) => Alert.alert(t('serverSettings.moveFailed'), errorMessage(e)))
  }

  const roles = [...detail.data.roles].sort((a, b) => b.position - a.position)
  const canMove = (roleId: string, delta: -1 | 1) => !!reorderRoleIds(detail.data?.roles ?? [], roleId, delta, perms.roleBelow)
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <View style={{ gap: spacing.sm }}>
        <TextField label={t('serverSettings.roles.newRole')} value={name} onChangeText={setName} maxLength={100} placeholder={t('serverSettings.roles.placeholder')} error={error} />
        <Button title={t('serverSettings.roles.create')} icon="add" onPress={create} loading={creating} />
      </View>
      <Section title={t('serverSettings.roles.count', { n: roles.length })} footer={t('serverSettings.roles.footer')}>
        {roles.map((r) => {
          const editable = perms.roleBelow(r)
          return (
            <Row
              key={r.id}
              icon="shield"
              title={r.name}
              subtitle={editable ? null : t('serverSettings.roles.above')}
              chevron={editable}
              right={
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: roleColorHex(r.color) ?? colors.textMuted }} accessible={false} />
                  {r.is_everyone ? null : (
                    <>
                      <IconButton icon="chevron-up" label={t('serverSettings.moveUp', { name: r.name })} disabled={!canMove(r.id, -1)} onPress={() => move(r.id, -1)} />
                      <IconButton icon="chevron-down" label={t('serverSettings.moveDown', { name: r.name })} disabled={!canMove(r.id, 1)} onPress={() => move(r.id, 1)} />
                    </>
                  )}
                </View>
              }
              onPress={editable ? () => router.push({ pathname: '/server/[serverId]/settings/role/[roleId]', params: { serverId: sid, roleId: r.id } }) : undefined}
            />
          )
        })}
      </Section>
    </ScrollView>
  )
}
