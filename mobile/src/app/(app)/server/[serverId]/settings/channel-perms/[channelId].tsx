import { Ionicons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { channelsApi, type ChannelOverride } from '@/api/channels'
import { serversApi } from '@/api/servers'
import { Sheet } from '@/components/Sheet'
import { Button, ErrorState, IconButton, Loading, Row, Section, T, type IconName } from '@/components/ui'
import { useServerDetail } from '@/features/servers/menus'
import { CHANNEL_PERMS, overrideState, setOverrideState, type OverrideState } from '@/features/servers/overrides'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { qk, queryClient } from '@/lib/queryClient'
import { colors, font, radius, spacing } from '@/theme'

const STATES: { state: OverrideState; icon: IconName; label: string; color: string }[] = [
  { state: 'deny', icon: 'close', label: 'refusé', color: colors.danger },
  { state: 'inherit', icon: 'remove', label: 'hérité', color: colors.textMuted },
  { state: 'allow', icon: 'checkmark', label: 'autorisé', color: colors.success },
]

/** Surcharges de permissions d'un salon (GET/PUT/DELETE /channels/:id/permissions). */
export default function ChannelPermissionsScreen() {
  const { valid, ids } = useRouteParams(['serverId', 'channelId'] as const)
  const sid = ids.serverId ?? ''
  const cid = ids.channelId ?? ''
  const detail = useServerDetail(sid, valid)
  const overrides = useQuery({ queryKey: ['channel-perms', cid], queryFn: () => channelsApi.permissions(cid), enabled: valid })
  const members = useQuery({ queryKey: qk.members(sid), queryFn: () => serversApi.members(sid), enabled: valid })
  const [edit, setEdit] = useState<ChannelOverride | null>(null)
  const [picker, setPicker] = useState<'role' | 'member' | null>(null)
  const [saving, setSaving] = useState(false)

  if (!valid) return <ErrorState message="Salon invalide." />
  if (overrides.isLoading || detail.isLoading) return <Loading />
  if (overrides.error) return <ErrorState message={errorMessage(overrides.error)} onRetry={() => void overrides.refetch()} />

  const roles = [...(detail.data?.roles ?? [])].sort((a, b) => b.position - a.position)
  const list = overrides.data ?? []
  const nameOf = (o: Pick<ChannelOverride, 'target_id' | 'target_type'>) =>
    o.target_type === 'role'
      ? (roles.find((r) => r.id === o.target_id)?.name ?? 'Rôle supprimé')
      : (members.data?.find((m) => m.user_id === o.target_id)?.username ?? 'Ancien membre')
  const taken = new Set(list.map((o) => o.target_id))
  const refresh = () => Promise.all([['channel-perms', cid], qk.channels(sid), qk.server(sid)].map((queryKey) => queryClient.invalidateQueries({ queryKey })))

  const save = async () => {
    if (!edit) return
    setSaving(true)
    try {
      await channelsApi.setPermission(cid, edit)
      await refresh()
      setEdit(null)
    } catch (e) {
      Alert.alert('Enregistrement impossible', errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const remove = (o: ChannelOverride) =>
    Alert.alert(`Retirer la surcharge de « ${nameOf(o)} » ?`, 'Ses droits redeviennent ceux du serveur.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Retirer',
        style: 'destructive',
        onPress: () =>
          void channelsApi
            .deletePermission(cid, o.target_id)
            .then(refresh)
            .then(() => setEdit(null))
            .catch((e) => Alert.alert('Action impossible', errorMessage(e))),
      },
    ])

  const start = (target_type: 'role' | 'member', target_id: string) => setEdit({ target_type, target_id, allow: 0, deny: 0 })

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
      <Stack.Screen options={{ title: 'Permissions du salon' }} />
      {edit ? (
        <>
          <Section title={`${nameOf(edit)} · ${edit.target_type === 'role' ? 'rôle' : 'membre'}`} footer="Hérité : le droit du serveur s'applique. Le refus d'un rôle cède devant l'autorisation d'un autre rôle ; le réglage d'un membre prime.">
            {CHANNEL_PERMS.map((p) => {
              const current = overrideState(edit, p.bit)
              return (
                <View key={p.bit} style={styles.permRow}>
                  <Text style={styles.permLabel}>{p.label}</Text>
                  <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel={p.label}>
                    {STATES.map((s) => {
                      const on = current === s.state
                      return (
                        <Pressable
                          key={s.state}
                          onPress={() => setEdit((o) => o && { ...o, ...setOverrideState(o, p.bit, s.state) })}
                          accessibilityRole="radio"
                          accessibilityLabel={`${p.label} : ${s.label}`}
                          accessibilityState={{ selected: on }}
                          hitSlop={4}
                          style={[styles.segmentItem, on && { backgroundColor: s.color }]}
                        >
                          <Ionicons name={s.icon} size={18} color={on ? colors.text : colors.textMuted} />
                        </Pressable>
                      )
                    })}
                  </View>
                </View>
              )
            })}
          </Section>
          <Button title="Enregistrer" onPress={save} loading={saving} />
          <Button title="Annuler" variant="secondary" onPress={() => setEdit(null)} />
        </>
      ) : (
        <>
          <Section title="Surcharges" footer="Toucher une ligne pour la modifier.">
            {list.length ? null : <Row title="Aucune : les droits du serveur s'appliquent." />}
            {list.map((o) => (
              <Row
                key={o.target_id}
                icon={o.target_type === 'role' ? 'shield-outline' : 'person-outline'}
                title={nameOf(o)}
                subtitle={o.target_type === 'role' ? 'Rôle' : 'Membre'}
                onPress={() => setEdit(o)}
                right={<IconButton icon="trash-outline" label={`Retirer la surcharge de ${nameOf(o)}`} color={colors.danger} onPress={() => remove(o)} />}
              />
            ))}
          </Section>
          <Button title="Ajouter un rôle" icon="shield-outline" variant="secondary" onPress={() => setPicker('role')} />
          <Button title="Ajouter un membre" icon="person-add-outline" variant="secondary" onPress={() => setPicker('member')} />
          {members.error ? <T variant="error">{errorMessage(members.error)}</T> : null}
        </>
      )}
      <Sheet
        visible={picker !== null}
        onClose={() => setPicker(null)}
        title={picker === 'role' ? 'Choisir un rôle' : 'Choisir un membre'}
        actions={
          picker === 'role'
            ? roles.filter((r) => !taken.has(r.id)).map((r) => ({ label: r.name, icon: 'shield-outline' as const, onPress: () => start('role', r.id) }))
            : (members.data ?? [])
                .filter((m) => !taken.has(m.user_id))
                .map((m) => ({ label: m.nickname ? `${m.nickname} (${m.username})` : m.username, icon: 'person-outline' as const, onPress: () => start('member', m.user_id) }))
        }
      />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  permRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, minHeight: 52 },
  permLabel: { flex: 1, color: colors.text, fontSize: font.md },
  segment: { flexDirection: 'row', backgroundColor: colors.bgDeep, borderRadius: radius.md, padding: 2, gap: 2 },
  segmentItem: { width: 40, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
})
