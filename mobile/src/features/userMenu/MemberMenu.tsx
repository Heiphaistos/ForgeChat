// Partie « serveur » du menu d'appui long sur une personne : modération (rôles, vocal, expulsion,
// bannissement, exclusion temporaire), seulement si j'en ai le droit (perms.ts) ; le serveur revérifie.
// Bannir et exclure ouvrent la gestion du membre, qui porte déjà le choix des durées.
import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, View } from 'react-native'
import { moderationApi } from '@/api/moderation'
import { serversApi } from '@/api/servers'
import { Sheet, type SheetAction } from '@/components/Sheet'
import { Button, TextField } from '@/components/ui'
import { useServerDetail, useServerPerms } from '@/features/servers/menus'
import { PERM, memberActions } from '@/features/servers/perms'
import { t as tr, useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { qk, queryClient } from '@/lib/queryClient'
import { colors, font, radius, spacing } from '@/theme'
import type { ModFacts, UserAction } from './model'

type ModAction = Extract<UserAction, 'roles' | 'moveTo' | 'serverMute' | 'serverDeafen' | 'disconnect' | 'kick' | 'ban' | 'timeout' | 'nickname'>

const fail = (e: unknown) => Alert.alert(tr('common.actionFailed'), errorMessage(e))

export function useMemberMenu(target: { userId: string; name: string; serverId?: string | null } | null) {
  const t = useT()
  const sid = target?.serverId ?? ''
  const on = !!sid
  const detail = useServerDetail(sid, on)
  const perms = useServerPerms(sid, on)
  const members = useQuery({ queryKey: qk.members(sid), queryFn: () => serversApi.members(sid), enabled: on, staleTime: 30_000 })
  const voice = useQuery({ queryKey: ['voice-state'], queryFn: moderationApi.voiceState, enabled: on })
  const [sub, setSub] = useState<'roles' | 'moveTo' | null>(null)
  const [nickOpen, setNickOpen] = useState(false)

  const member = target ? members.data?.find((m) => m.user_id === target.userId) : undefined
  const room = target ? voice.data?.channels.find((c) => c.server_id === sid && c.participants.some((p) => p.user_id === target.userId)) : undefined
  const live = room?.participants.find((p) => p.user_id === target?.userId)
  const roles = [...(detail.data?.roles ?? [])].filter((r) => !r.is_everyone && perms.roleBelow(r)).sort((a, b) => b.position - a.position)
  const voiceChannels = (detail.data?.channels ?? []).filter((c) => (c.type === 'voice' || c.type === 'video') && c.id !== room?.channel_id)

  let mod: ModFacts | null = null
  if (target && member && perms.loaded) {
    const can = memberActions(perms, member)
    // Vocal : le serveur accepte aussi d'agir sur soi-même (voice_moderation.rs).
    const voiceTarget = member.user_id === perms.meId || perms.outranks(member)
    mod = {
      roles: can.roles && roles.length > 0,
      move: voiceTarget && perms.has(PERM.MOVE_MEMBERS),
      mute: voiceTarget && perms.has(PERM.MUTE_MEMBERS),
      deafen: voiceTarget && perms.has(PERM.DEAFEN_MEMBERS),
      inVoice: !!room,
      kick: can.kick,
      ban: can.ban,
      timeout: can.timeout,
      nickname: member.user_id === perms.meId || can.nickname,
    }
  }

  const uid = target?.userId ?? ''
  const refreshMembers = () => void queryClient.invalidateQueries({ queryKey: qk.members(sid) })
  const voiceRun = (body: Parameters<typeof moderationApi.voice>[2]) => void moderationApi.voice(sid, uid, body).then(() => voice.refetch(), fail)
  const manage = () => router.push({ pathname: '/server/[serverId]/settings/member/[userId]', params: { serverId: sid, userId: uid } })

  const run: Record<ModAction, () => void> = {
    roles: () => setSub('roles'),
    moveTo: () => setSub('moveTo'),
    serverMute: () => voiceRun({ mute: !live?.server_muted }),
    serverDeafen: () => voiceRun({ deafen: !live?.server_deafened }),
    disconnect: () => voiceRun({ disconnect: true }),
    kick: () =>
      Alert.alert(t('serverSettings.member.kickConfirm', { name: target?.name ?? '' }), undefined, [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('serverSettings.member.kick'), style: 'destructive', onPress: () => void serversApi.kick(sid, uid).then(refreshMembers, fail) },
      ]),
    ban: manage,
    timeout: manage,
    nickname: () => (uid === perms.meId ? router.push({ pathname: '/server/[serverId]/nickname', params: { serverId: sid } }) : setNickOpen(true)),
  }
  const selected: Partial<Record<UserAction, boolean>> = { serverMute: !!live?.server_muted, serverDeafen: !!live?.server_deafened }

  const mine = new Set(member?.role_ids ?? [])
  const subActions: SheetAction[] =
    sub === 'roles'
      ? roles.map((r) => ({
          label: r.name,
          icon: 'shield-outline',
          selected: mine.has(r.id),
          onPress: () => void (mine.has(r.id) ? serversApi.removeRole(sid, uid, r.id) : serversApi.assignRole(sid, uid, r.id)).then(refreshMembers, fail),
        }))
      : voiceChannels.map((c) => ({ label: c.name, icon: 'volume-medium-outline', onPress: () => voiceRun({ channel_id: c.id }) }))

  const saveNick = (nickname: string) => {
    if (!member) return
    const next = nickname.trim() || null
    serversApi.setMemberNickname(sid, uid, next).then(() => {
      queryClient.setQueryData<typeof members.data>(qk.members(sid), (old) => old?.map((m) => (m.user_id === uid ? { ...m, nickname: next } : m)))
      refreshMembers()
      setNickOpen(false)
      Alert.alert(t(next ? 'ux.um.nickChanged' : 'ux.um.nickCleared', { name: member.username }))
    }, fail)
  }

  const node = (
    <>
      <Sheet visible={sub !== null} onClose={() => setSub(null)} title={t(sub === 'roles' ? 'ux.um.roles' : 'ux.um.moveTo')} actions={subActions} />
      {nickOpen && member ? (
        <NicknameDialog name={member.nickname || member.username} username={member.username} initial={member.nickname ?? ''} onClose={() => setNickOpen(false)} onSave={saveNick} />
      ) : null}
    </>
  )
  return { mod, run, selected, node }
}

/** Pseudo d'un autre membre : champ prérempli, « Réinitialiser » retire le pseudo. */
function NicknameDialog({ name, username, initial, onClose, onSave }: {
  name: string; username: string; initial: string; onClose: () => void; onSave: (nickname: string) => void
}) {
  const t = useT()
  const [text, setText] = useState(initial)
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{t('ux.um.nickTitle', { name })}</Text>
          <TextField value={text} onChangeText={setText} maxLength={32} placeholder={username} autoCorrect={false} autoFocus />
          <Text style={styles.hint}>{t('ux.um.nickHint', { name: username })}</Text>
          <View style={styles.buttons}>
            <Button title={t('common.cancel')} variant="ghost" onPress={onClose} />
            <Button title={t('ux.um.nickReset')} variant="ghost" disabled={!initial} onPress={() => onSave('')} />
            <Button title={t('ux.um.save')} onPress={() => onSave(text)} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: spacing.xl },
  card: { backgroundColor: colors.bgAlt, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  title: { color: colors.text, fontSize: font.md, fontWeight: '700' },
  hint: { color: colors.textMuted, fontSize: font.xs },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: spacing.sm },
})
