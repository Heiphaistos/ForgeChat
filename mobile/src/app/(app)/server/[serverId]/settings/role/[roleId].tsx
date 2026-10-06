import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, Pressable, ScrollView, View } from 'react-native'
import { serversApi } from '@/api/servers'
import { Button, ErrorState, Loading, Row, Section, SwitchRow, T, TextField } from '@/components/ui'
import { useServerDetail, useServerPerms } from '@/features/servers/menus'
import { PERMISSION_GROUPS, hasBit, roleColorHex, toggleBit } from '@/features/servers/perms'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { qk, queryClient } from '@/lib/queryClient'
import type { Role } from '@/types/models'
import { colors, spacing } from '@/theme'

const COLORS = [0, 0x5865f2, 0x3ba55c, 0xfaa61a, 0xed4245, 0xeb459e, 0x9b59b6, 0x1abc9c, 0xe67e22, 0x95a5a6]

/** Modifier un rôle : nom, couleur, permissions ; suppression. Le serveur refuse d'accorder un droit qu'on n'a pas. */
export default function EditRoleScreen() {
  const { valid, ids } = useRouteParams(['serverId', 'roleId'] as const)
  const sid = ids.serverId ?? ''
  const detail = useServerDetail(sid, valid)
  const role = detail.data?.roles.find((r) => r.id === ids.roleId)
  if (!valid) return <ErrorState message="Rôle invalide." />
  if (detail.isLoading) return <Loading />
  if (!role) return <ErrorState message={detail.error ? errorMessage(detail.error) : 'Rôle introuvable.'} />
  return <RoleForm key={role.id} serverId={sid} role={role} />
}

function RoleForm({ serverId: sid, role }: { serverId: string; role: Role }) {
  const perms = useServerPerms(sid)
  const [name, setName] = useState(role.name)
  const [color, setColor] = useState(role.color)
  const [bits, setBits] = useState(role.permissions)
  const [hoisted, setHoisted] = useState(role.hoisted)
  const [mentionable, setMentionable] = useState(role.mentionable)
  const members = useQuery({ queryKey: ['role-members', sid, role.id], queryFn: () => serversApi.roleMembers(sid, role.id), enabled: !role.is_everyone })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.server(sid) })

  const save = async () => {
    if (!name.trim()) return setError('Le nom est requis.')
    setSaving(true)
    setError(null)
    try {
      await serversApi.updateRole(sid, role.id, { ...(role.is_everyone ? {} : { name: name.trim(), color, hoisted, mentionable }), permissions: bits })
      await refresh()
      router.back()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const remove = () =>
    Alert.alert(`Supprimer le rôle « ${role.name} » ?`, 'Les membres qui l’ont le perdent.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: () =>
          void serversApi
            .deleteRole(sid, role.id)
            .then(refresh)
            .then(() => router.back())
            .catch((e) => Alert.alert('Suppression impossible', errorMessage(e))),
      },
    ])

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      {role.is_everyone ? (
        <T variant="muted">@everyone : permissions de base de tous les membres.</T>
      ) : (
        <>
          <TextField label="Nom du rôle" value={name} onChangeText={setName} maxLength={100} />
          <View style={{ gap: spacing.sm }}>
            <T variant="label">Couleur</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }} accessibilityRole="radiogroup" accessibilityLabel="Couleur du rôle">
              {COLORS.map((c) => {
                const hex = roleColorHex(c)
                return (
                  <Pressable
                    key={c}
                    onPress={() => setColor(c)}
                    accessibilityRole="radio"
                    accessibilityLabel={hex ?? 'Sans couleur'}
                    accessibilityState={{ selected: color === c }}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      backgroundColor: hex ?? colors.bgElevated,
                      borderWidth: 3,
                      borderColor: color === c ? colors.text : 'transparent',
                    }}
                  />
                )
              })}
            </View>
          </View>
          <Section>
            <SwitchRow icon="list-outline" title="Afficher séparément" subtitle="Ses membres forment un groupe dans la liste des membres" value={hoisted} onValueChange={setHoisted} />
            <SwitchRow icon="at-outline" title="Mentionnable" subtitle="Tout le monde peut écrire @rôle" value={mentionable} onValueChange={setMentionable} />
          </Section>
        </>
      )}
      {PERMISSION_GROUPS.map((g) => (
        <Section key={g.label} title={g.label}>
          {g.perms.map((p) => {
            const on = hasBit(bits, p.bit)
            return (
              <SwitchRow
                key={p.bit}
                title={p.label}
                value={on}
                // Le serveur refuse d'ajouter un droit que l'on n'a pas soi-même (anti-élévation).
                disabled={!on && !perms.has(p.bit)}
                onValueChange={() => setBits((b) => toggleBit(b, p.bit))}
              />
            )
          })}
        </Section>
      ))}
      {error ? <T variant="error">{error}</T> : null}
      <Button title="Enregistrer" onPress={save} loading={saving} />
      {role.is_everyone ? null : (
        <Section title={`Membres${members.data ? ` (${members.data.length})` : ''}`}>
          {members.isLoading ? <Row title="Chargement…" /> : null}
          {members.data?.length === 0 ? <Row title="Aucun membre n’a ce rôle" /> : null}
          {(members.data ?? []).map((m) => (
            <Row
              key={m.id}
              icon="person-outline"
              title={m.nick || m.username}
              subtitle={m.nick ? m.username : null}
              chevron
              onPress={() => router.push({ pathname: '/server/[serverId]/settings/member/[userId]', params: { serverId: sid, userId: m.id } })}
            />
          ))}
        </Section>
      )}
      {role.is_everyone ? null : <Button title="Supprimer le rôle" variant="danger" icon="trash-outline" onPress={remove} />}
    </ScrollView>
  )
}
