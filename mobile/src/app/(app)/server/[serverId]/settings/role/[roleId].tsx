import { useQuery } from '@tanstack/react-query'
import * as ImagePicker from 'expo-image-picker'
import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, Pressable, ScrollView, View } from 'react-native'
import { serversApi } from '@/api/servers'
import { Button, ErrorState, Loading, Row, Section, SwitchRow, T, TextField } from '@/components/ui'
import { useServerDetail, useServerPerms } from '@/features/servers/menus'
import { PERMISSION_GROUPS, hasBit, roleColorHex, toggleBit } from '@/features/servers/perms'
import { RoleIcon } from '@/features/servers/roleDecor'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { ensurePhotoAccess } from '@/lib/photoAccess'
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
  const t = useT()
  if (!valid) return <ErrorState message={t('serverSettings.role.invalid')} />
  if (detail.isLoading) return <Loading />
  if (!role) return <ErrorState message={detail.error ? errorMessage(detail.error) : t('serverSettings.role.notFound')} />
  return <RoleForm key={role.id} serverId={sid} role={role} />
}

function RoleForm({ serverId: sid, role }: { serverId: string; role: Role }) {
  const perms = useServerPerms(sid)
  const t = useT()
  const [name, setName] = useState(role.name)
  const [color, setColor] = useState(role.color)
  const [bits, setBits] = useState(role.permissions)
  const [hoisted, setHoisted] = useState(role.hoisted)
  const [mentionable, setMentionable] = useState(role.mentionable)
  // Dégradé (null = couleur unie ; le mobile affiche la première couleur, le web le dégradé)
  const [color2, setColor2] = useState<number | null>(role.secondary_color ?? null)
  const [icon, setIcon] = useState(role.icon ?? '')
  const [uploading, setUploading] = useState(false)
  const members = useQuery({ queryKey: ['role-members', sid, role.id], queryFn: () => serversApi.roleMembers(sid, role.id), enabled: !role.is_everyone })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.server(sid) })

  const save = async () => {
    if (!name.trim()) return setError(t('serverSettings.role.nameRequired'))
    setSaving(true)
    setError(null)
    try {
      // Une image passe par uploadRoleIcon : on n'envoie que l'emoji ou le retrait.
      const iconPatch = icon.startsWith('/uploads/') ? {} : { icon: icon.trim() }
      await serversApi.updateRole(sid, role.id, {
        ...(role.is_everyone ? {} : { name: name.trim(), color, hoisted, mentionable, secondary_color: color2 ?? -1, ...iconPatch }),
        permissions: bits,
      })
      await refresh()
      router.back()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const pickIcon = async () => {
    if (!(await ensurePhotoAccess())) return
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 })
    const a = res.canceled ? undefined : res.assets[0]
    if (!a) return
    if (a.fileSize && a.fileSize > 256 * 1024) return Alert.alert(t('serverSettings.imageTooLarge'), t('serverSettings.maxKb', { n: 256 }))
    setUploading(true)
    try {
      const updated = await serversApi.uploadRoleIcon(sid, role.id, { uri: a.uri, name: 'icon.jpg', type: 'image/jpeg' })
      setIcon(updated?.icon ?? '')
      await refresh()
    } catch (e) {
      Alert.alert(t('serverSettings.uploadFailed'), errorMessage(e))
    } finally {
      setUploading(false)
    }
  }

  const remove = () =>
    Alert.alert(t('serverSettings.role.deleteTitle', { name: role.name }), t('serverSettings.role.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () =>
          void serversApi
            .deleteRole(sid, role.id)
            .then(refresh)
            .then(() => router.back())
            .catch((e) => Alert.alert(t('serverSettings.deleteFailed'), errorMessage(e))),
      },
    ])

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      {role.is_everyone ? (
        <T variant="muted">{t('serverSettings.role.everyone')}</T>
      ) : (
        <>
          <TextField label={t('serverSettings.role.name')} value={name} onChangeText={setName} maxLength={100} />
          <View style={{ gap: spacing.sm }}>
            <T variant="label">{t('serverSettings.role.color')}</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }} accessibilityRole="radiogroup" accessibilityLabel={t('serverSettings.role.colorA11y')}>
              {COLORS.map((c) => {
                const hex = roleColorHex(c)
                return (
                  <Pressable
                    key={c}
                    onPress={() => setColor(c)}
                    accessibilityRole="radio"
                    accessibilityLabel={hex ?? t('serverSettings.role.noColor')}
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
          <View style={{ gap: spacing.sm }}>
            <T variant="label">{t('serverSettings.role.gradient')}</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }} accessibilityRole="radiogroup" accessibilityLabel={t('serverSettings.role.gradientA11y')}>
              {COLORS.map((c) => {
                const hex = roleColorHex(c)
                const value = c ? c : null
                return (
                  <Pressable
                    key={c}
                    onPress={() => setColor2(value)}
                    accessibilityRole="radio"
                    accessibilityLabel={hex ?? t('serverSettings.role.noGradient')}
                    accessibilityState={{ selected: color2 === value }}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      backgroundColor: hex ?? colors.bgElevated,
                      borderWidth: 3,
                      borderColor: color2 === value ? colors.text : 'transparent',
                    }}
                  />
                )
              })}
            </View>
          </View>
          <View style={{ gap: spacing.sm }}>
            <T variant="label">{t('serverSettings.role.icon')}</T>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <RoleIcon icon={icon} title={name} size={28} />
              <View style={{ flex: 1 }}>
                <TextField label={t('serverSettings.role.emoji')} value={icon.startsWith('/uploads/') ? '' : icon} onChangeText={setIcon} maxLength={16} />
              </View>
            </View>
            <Button title={t(uploading ? 'serverSettings.role.uploading' : 'serverSettings.role.pickImage')} variant="secondary" icon="image-outline" onPress={() => void pickIcon()} loading={uploading} />
            {icon ? <Button title={t('serverSettings.role.removeIcon')} variant="secondary" onPress={() => setIcon('')} /> : null}
          </View>
          <Section>
            <SwitchRow icon="list-outline" title={t('serverSettings.role.hoist')}
              subtitle={t('serverSettings.role.hoistSub')} value={hoisted} onValueChange={setHoisted} />
            <SwitchRow icon="at-outline" title={t('serverSettings.role.mentionable')}
              subtitle={t('serverSettings.role.mentionableSub')} value={mentionable} onValueChange={setMentionable} />
          </Section>
        </>
      )}
      {PERMISSION_GROUPS.map((g) => (
        <Section key={g.label} title={t(g.label)}>
          {g.perms.map((p) => {
            const on = hasBit(bits, p.bit)
            return (
              <SwitchRow
                key={p.bit}
                title={t(p.label)}
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
      <Button title={t('serverSettings.save')} onPress={save} loading={saving} />
      {role.is_everyone ? null : (
        <Section title={members.data ? t('serverSettings.membersCount', { n: members.data.length }) : t('screen.members')}>
          {members.isLoading ? <Row title={t('serverSettings.role.loading')} /> : null}
          {members.data?.length === 0 ? <Row title={t('serverSettings.role.noMembers')} /> : null}
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
      {role.is_everyone ? null : <Button title={t('serverSettings.role.delete')} variant="danger" icon="trash-outline" onPress={remove} />}
    </ScrollView>
  )
}
