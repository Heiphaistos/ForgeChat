// Menu d'appui long sur une personne (pseudo ou avatar : messages, membres, vocal, MP, amis) ou
// sur une conversation privée, monté une seule fois (app/(app)/_layout). Même contenu que le
// menu utilisateur du web : profil, message, appel, note privée (chiffrée, e2e/notes), pseudo
// d'ami, volume, muet / soundboard / vidéo pour moi seul, code de vérification, modération (MemberMenu), invitation (lien envoyé chiffré dans le MP), ami, favori, sourdine du MP,
// ignorer, bloquer, avatar, identifiant ; pour une conversation : lu, épingler, fermer…
import { useQuery } from '@tanstack/react-query'
import * as Clipboard from 'expo-clipboard'
import { Image } from 'expo-image'
import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { create } from 'zustand'
import { dmsApi } from '@/api/dms'
import { friendsApi } from '@/api/friends'
import { messagesApi } from '@/api/messages'
import { serversApi } from '@/api/servers'
import { socialApi } from '@/api/social'
import { usersApi } from '@/api/users'
import { PeerVolumeSheet } from '@/components/call/PeerVolumeSheet'
import { Sheet, type SheetAction } from '@/components/Sheet'
import { Button, TextField, type IconName } from '@/components/ui'
import { apiOrigin } from '@/config/env'
import { SafetyCode } from '@/e2e/E2ESettings'
import { NOTE_LOCKED, loadNote, saveNote } from '@/e2e/notes'
import { applyConversationSettings } from '@/features/dms/conversations'
import { openDmWith } from '@/features/friends/openDm'
import { relationWith } from '@/features/friends/relation'
import { userRoute } from '@/features/servers/memberProfile'
import { t as tr, useT, type Key } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { resolveMediaUrl } from '@/lib/links'
import { qk, queryClient } from '@/lib/queryClient'
import { getMyId } from '@/stores/auth'
import { useCall } from '@/stores/call'
import { useGroupCall } from '@/stores/groupCall'
import { useUnread } from '@/stores/unread'
import { usePeerVolumes } from '@/stores/peerVolumes'
import { useVoice } from '@/stores/voice'
import type { ConversationSummary, DmSummary } from '@/types/models'
import { colors, font, radius, spacing } from '@/theme'
import { useLocalPrefs, useMyLocalPrefs } from './localPrefs'
import { useMemberMenu } from './MemberMenu'
import { MUTE_MINUTES, buildConvMenu, buildUserMenu, type ConvAction, type RelationKind, type UserAction } from './model'

export interface UserTarget {
  userId: string
  name: string
  avatar?: string | null
  /** Ouvert depuis un serveur : profil propre au serveur. */
  serverId?: string | null
  /** Ouvert depuis un salon vocal ou un appel : entrée « Volume ». */
  volume?: boolean
}

interface MenuState {
  user: UserTarget | null
  conv: ConversationSummary | null
}
const useMenu = create<MenuState>(() => ({ user: null, conv: null }))

/** Appui long sur un pseudo ou un avatar. */
export const openUserMenu = (user: UserTarget) => useMenu.setState({ user, conv: null })
/** Appui long sur une conversation de la liste (MP : le menu de la personne suit). */
export const openConvMenu = (conv: ConversationSummary) =>
  useMenu.setState({ conv, user: conv.is_group ? null : { userId: conv.other_user_id, name: conv.username, avatar: conv.avatar } })

const USER_LABEL: Record<UserAction, Key> = {
  profile: 'ux.um.profile', message: 'ux.um.message', call: 'ux.um.call', note: 'ux.um.note', friendNick: 'ux.um.friendNick',
  volume: 'ux.um.volume', voiceMute: 'ux.um.voiceMute', soundboardMute: 'ux.um.soundboardMute', videoOff: 'ux.um.videoOff',
  safetyCode: 'ux.um.safetyCode', invite: 'ux.um.invite', addFriend: 'ux.um.addFriend', acceptFriend: 'ux.um.acceptFriend',
  removeFriend: 'ux.um.removeFriend', favorite: 'ux.um.favorite', unfavorite: 'ux.um.unfavorite', mute: 'ux.um.mute',
  unmute: 'ux.um.unmute', ignore: 'ux.um.ignore', unignore: 'ux.um.unignore', block: 'ux.um.block', unblock: 'ux.um.unblock',
  roles: 'ux.um.roles', moveTo: 'ux.um.moveTo', serverMute: 'ux.um.serverMute', serverDeafen: 'ux.um.serverDeafen',
  disconnect: 'ux.um.disconnect', kick: 'ux.um.kick', ban: 'ux.um.ban', timeout: 'ux.um.timeout',
  viewAvatar: 'ux.um.viewAvatar', copyId: 'ux.um.copyId',
}
const DANGER = new Set<UserAction>(['block', 'serverMute', 'serverDeafen', 'disconnect', 'kick', 'ban'])
const USER_ICON: Record<UserAction, IconName> = {
  profile: 'person-circle-outline', message: 'chatbubble-outline', call: 'call-outline', note: 'create-outline', friendNick: 'pricetag-outline',
  volume: 'volume-high-outline', voiceMute: 'mic-off-outline', soundboardMute: 'musical-notes-outline', videoOff: 'videocam-off-outline',
  safetyCode: 'shield-checkmark-outline', invite: 'mail-outline', addFriend: 'person-add-outline', acceptFriend: 'person-add-outline',
  removeFriend: 'person-remove-outline', favorite: 'star-outline', unfavorite: 'star', mute: 'notifications-off-outline',
  unmute: 'notifications-outline', ignore: 'eye-off-outline', unignore: 'eye-outline', block: 'ban', unblock: 'lock-open-outline',
  roles: 'shield-outline', moveTo: 'swap-horizontal-outline', serverMute: 'mic-off', serverDeafen: 'volume-mute',
  disconnect: 'call-outline', kick: 'exit-outline', ban: 'ban-outline', timeout: 'time-outline',
  viewAvatar: 'image-outline', copyId: 'copy-outline',
}
const CONV_LABEL: Record<ConvAction, Key> = {
  markRead: 'ux.um.markRead', pin: 'ux.um.pin', unpin: 'ux.um.unpin', muteGroup: 'ux.um.muteGroup', unmuteGroup: 'ux.um.unmuteGroup',
  archive: 'dms.archive', unarchive: 'dms.unarchive', close: 'ux.um.close', leave: 'ux.um.leave', copyConvId: 'ux.um.copyConvId',
}
const CONV_ICON: Record<ConvAction, IconName> = {
  markRead: 'checkmark-done-outline', pin: 'pin-outline', unpin: 'pin', muteGroup: 'notifications-off-outline', unmuteGroup: 'notifications-outline',
  archive: 'archive-outline', unarchive: 'archive-outline', close: 'close-circle-outline', leave: 'exit-outline', copyConvId: 'copy-outline',
}

const fail = (e: unknown) => Alert.alert(tr('common.actionFailed'), errorMessage(e))
const refreshConvs = () => void queryClient.invalidateQueries({ queryKey: qk.conversations })
/** Réglage d'une conversation (PATCH /dms/:id/settings) avec mise à jour optimiste de la liste. */
function patchConv(id: string, patch: { muted?: boolean; archived?: boolean; mute_minutes?: number }) {
  const previous = queryClient.getQueryData<ConversationSummary[]>(qk.conversations)
  if (previous) queryClient.setQueryData(qk.conversations, applyConversationSettings(previous, id, patch))
  dmsApi.setSettings(id, patch).then(refreshConvs, (e) => {
    if (previous) queryClient.setQueryData(qk.conversations, previous)
    fail(e)
  })
}
const refreshFriends = () => void queryClient.invalidateQueries({ queryKey: qk.friendsAll })
const ask = (title: string, body: string, ok: string, fn: () => void) =>
  Alert.alert(title, body, [{ text: tr('common.cancel'), style: 'cancel' }, { text: ok, style: 'destructive', onPress: fn }])

type Sub = 'mute' | 'muteGroup' | 'invite' | 'volume' | null
type Editor = { kind: 'note' | 'nick'; text: string } | null

export default function UserMenuHost() {
  const t = useT()
  const { user, conv } = useMenu()
  const open = !!(user || conv)
  const [sub, setSub] = useState<Sub>(null)
  const [subTarget, setSubTarget] = useState<{ user: UserTarget | null; conv: ConversationSummary | null }>({ user: null, conv: null })
  const [editor, setEditor] = useState<Editor>(null)
  const [editorUser, setEditorUser] = useState<UserTarget | null>(null)
  const [avatar, setAvatar] = useState<string | null>(null)
  const [safety, setSafety] = useState<UserTarget | null>(null)
  const voiceMuted = usePeerVolumes((s) => s.muted)
  const setVoiceMuted = usePeerVolumes((s) => s.setMuted)
  const member = useMemberMenu(user)
  const local = useMyLocalPrefs()
  const toggleLocal = useLocalPrefs((s) => s.toggle)
  const setClosed = useLocalPrefs((s) => s.setClosed)

  // Faits : listes d'amis, conversations, serveurs (déjà en cache la plupart du temps).
  const accepted = useQuery({ queryKey: qk.friends('all'), queryFn: () => friendsApi.list('all'), enabled: !!user })
  const pending = useQuery({ queryKey: qk.friends('pending'), queryFn: () => friendsApi.list('pending'), enabled: !!user })
  const blocked = useQuery({ queryKey: qk.friends('blocked'), queryFn: () => friendsApi.list('blocked'), enabled: !!user })
  const convs = useQuery({ queryKey: qk.conversations, queryFn: dmsApi.list, enabled: open })
  const servers = useQuery({ queryKey: qk.servers, queryFn: serversApi.list, enabled: !!user })

  const close = () => useMenu.setState({ user: null, conv: null })
  const me = getMyId()
  const dmOf = (userId: string) => (convs.data ?? []).find((c): c is DmSummary => !c.is_group && c.other_user_id === userId) ?? null

  const userActions = (u: UserTarget): SheetAction[] => {
    const rel = relationWith(u.userId, [blocked.data?.friends, accepted.data?.friends, pending.data?.friends])
    const relation: RelationKind = u.userId === me ? 'self' : rel.kind
    const friend = accepted.data?.friends.find((f) => f.friend_id === u.userId)
    const dm = dmOf(u.userId)
    const run: Record<UserAction, () => void> = {
      profile: () => router.push(userRoute(u.userId, u.serverId ?? undefined)),
      message: () => void openDmWith(u.userId, u.name),
      call: () => void startCall(u),
      note: () => openEditor(u, 'note'),
      friendNick: () => openEditor(u, 'nick'),
      volume: () => openSub('volume', u, null),
      voiceMute: () => setVoiceMuted(u.userId, !voiceMuted.includes(u.userId)),
      soundboardMute: () => toggleLocal('soundboardMuted', u.userId, !local.soundboardMuted.includes(u.userId)),
      videoOff: () => toggleLocal('videoOff', u.userId, !local.videoOff.includes(u.userId)),
      safetyCode: () => setSafety(u),
      invite: () => openSub('invite', u, null),
      addFriend: () =>
        void usersApi.get(u.userId)
          .then((p) => friendsApi.addByName(`${p.username}#${p.discriminator}`))
          .then(() => Alert.alert(t('social.user.requestSent')), fail)
          .finally(refreshFriends),
      acceptFriend: () => rel.kind === 'received' && void friendsApi.accept(rel.friendshipId).then(refreshFriends, fail),
      removeFriend: () => ask(t('friends.removeConfirm'), u.name, t('friends.remove'), () => void friendsApi.remove(u.userId).then(refreshFriends, fail)),
      favorite: () => void socialApi.setFavorite(u.userId, true).then(refreshFriends, fail),
      unfavorite: () => void socialApi.setFavorite(u.userId, false).then(refreshFriends, fail),
      mute: () => openSub('mute', u, dm),
      unmute: () => dm && patchConv(dm.id, { muted: false }),
      ignore: () => toggleLocal('ignored', u.userId, true),
      unignore: () => toggleLocal('ignored', u.userId, false),
      block: () => ask(t('friends.blockConfirm'), t('friends.blockBody', { name: u.name }), t('friends.block'), () => void friendsApi.block(u.userId).then(refreshFriends, fail)),
      unblock: () => void friendsApi.unblock(u.userId).then(refreshFriends, fail),
      viewAvatar: () => setAvatar(resolveMediaUrl(u.avatar)),
      copyId: () => void Clipboard.setStringAsync(u.userId),
      ...member.run,
    }
    const selected: Partial<Record<UserAction, boolean>> = {
      ...member.selected,
      voiceMute: voiceMuted.includes(u.userId),
      soundboardMute: local.soundboardMuted.includes(u.userId),
      videoOff: local.videoOff.includes(u.userId),
    }
    return buildUserMenu({
      relation,
      favorite: !!friend?.is_favorite,
      ignored: local.ignored.includes(u.userId),
      dm: dm ? { muted: dm.is_muted } : null,
      canInvite: (servers.data ?? []).length > 0,
      volume: !!u.volume,
      hasAvatar: !!resolveMediaUrl(u.avatar),
      mod: member.mod,
    }).map((a) => ({ label: t(USER_LABEL[a], { name: u.name }), icon: USER_ICON[a], danger: DANGER.has(a), selected: selected[a], onPress: run[a] }))
  }

  const convActions = (c: ConversationSummary): SheetAction[] => {
    const serverPinned = (c as { is_pinned?: boolean }).is_pinned
    const pinned = serverPinned ?? local.pinned.includes(c.id)
    const ref = c.is_group ? ({ kind: 'group', groupId: c.id } as const) : ({ kind: 'dm', dmId: c.id } as const)
    const pin = (on: boolean) => {
      toggleLocal('pinned', c.id, on)
      void dmsApi.setSettings(c.id, { pinned: on }).then(refreshConvs, () => undefined)
    }
    const run: Record<ConvAction, () => void> = {
      markRead: () => {
        useUnread.getState().clear(c.id)
        void messagesApi.markRead(ref)?.catch(fail)
      },
      pin: () => pin(true),
      unpin: () => pin(false),
      muteGroup: () => openSub('muteGroup', null, c),
      unmuteGroup: () => patchConv(c.id, { muted: false }),
      archive: () => patchConv(c.id, { archived: true }),
      unarchive: () => patchConv(c.id, { archived: false }),
      close: () => {
        setClosed(c.id, Date.now())
        void dmsApi.setSettings(c.id, { closed: true }).then(refreshConvs, () => undefined)
      },
      leave: () => ask(t('ux.um.leave'), c.is_group ? c.name : '', t('ux.um.leave'), () => void dmsApi.leaveGroup(c.id).then(refreshConvs, fail)),
      copyConvId: () => void Clipboard.setStringAsync(c.id),
    }
    return buildConvMenu({
      group: c.is_group,
      pinned,
      muted: c.is_muted,
      archived: c.is_archived,
      unread: (useUnread.getState().counts[c.id] ?? 0) > 0,
    }).map((a) => ({ label: t(CONV_LABEL[a]), icon: CONV_ICON[a], danger: a === 'leave', onPress: run[a] }))
  }

  const openSub = (s: Sub, u: UserTarget | null, c: ConversationSummary | null) => {
    setSubTarget({ user: u, conv: c })
    setSub(s)
  }
  const openEditor = (u: UserTarget, kind: 'note' | 'nick') => {
    setEditorUser(u)
    const load = kind === 'note' ? loadNote(u.userId) : friendsApi.nickname(u.userId).then((r) => r.nickname)
    load.then(
      (text) => setEditor({ kind, text }),
      (e) => Alert.alert(t('common.actionFailed'), e instanceof Error && e.message === NOTE_LOCKED ? t('soc.note.locked') : errorMessage(e)),
    )
  }

  const actions = [...(conv ? convActions(conv) : []), ...(user ? userActions(user) : [])]
  const subActions = (): SheetAction[] => {
    if (sub === 'mute' || sub === 'muteGroup') {
      const id = subTarget.conv?.id
      return MUTE_MINUTES.map((m) => ({
        label: t(`ux.um.mute${m}` as Key),
        icon: 'notifications-off-outline' as IconName,
        onPress: () => id && patchConv(id, { muted: true, mute_minutes: m }),
      }))
    }
    if (sub === 'invite' && subTarget.user) {
      const u = subTarget.user
      return (servers.data ?? []).map((s) => ({ label: s.name, icon: 'mail-outline' as IconName, onPress: () => void inviteToServer(s.id, u).then(() => Alert.alert(t('ux.um.invited', { name: u.name })), fail) }))
    }
    return []
  }

  return (
    <>
      <Sheet visible={open} onClose={close} title={conv ? (conv.is_group ? conv.name : conv.username) : user?.name} actions={actions} />
      <Sheet
        visible={sub === 'mute' || sub === 'muteGroup' || sub === 'invite'}
        onClose={() => setSub(null)}
        title={sub === 'invite' ? t('ux.um.invite') : t('ux.um.muteFor')}
        actions={subActions()}
      />
      <PeerVolumeSheet
        peer={sub === 'volume' && subTarget.user ? { userId: subTarget.user.userId, name: subTarget.user.name } : null}
        onClose={() => setSub(null)}
        // Support à distance avec cette personne : son MP, menu déplié (on reste dans l'appel).
        extra={subTarget.user ? [{ label: t('rs.button'), icon: 'help-buoy-outline', onPress: () => subTarget.user && void openDmWith(subTarget.user.userId, subTarget.user.name, true) }] : []}
      />
      <TextEditor
        key={editor ? `${editor.kind}:${editorUser?.userId}` : 'closed'}
        editor={editor}
        name={editorUser?.name ?? ''}
        onClose={() => setEditor(null)}
        onSave={(text) => {
          const u = editorUser
          if (!u || !editor) return
          const save = editor.kind === 'note' ? saveNote(u.userId, text) : friendsApi.setNickname(u.userId, text.trim()).then(refreshFriends)
          void save.then(() => setEditor(null), fail)
        }}
      />
      <AvatarViewer uri={avatar} onClose={() => setAvatar(null)} />
      {member.node}
      <SafetyViewer user={safety} onClose={() => setSafety(null)} />
    </>
  )
}

async function startCall(u: UserTarget) {
  if (useVoice.getState().channelId) return Alert.alert(tr('conv.alreadyInVoice'), tr('conv.leaveVoiceFirst'))
  if (useGroupCall.getState().groupId) return Alert.alert(tr('conv.groupCallActive'), tr('conv.leaveGroupCallFirst'))
  try {
    const { dm_id } = await dmsApi.open(u.userId)
    await useCall.getState().start(dm_id, u.userId, u.name, 'voice', u.avatar ?? null)
    router.push('/call')
  } catch (e) {
    Alert.alert(tr('conv.callFailed'), errorMessage(e))
  }
}

/** Invitation de 7 jours envoyée (chiffrée, comme tout message privé) dans le MP de la personne. */
async function inviteToServer(serverId: string, u: UserTarget) {
  const { code } = await serversApi.createInvite(serverId, undefined, 168)
  const { dm_id } = await dmsApi.open(u.userId)
  await messagesApi.send({ kind: 'dm', dmId: dm_id, otherUserId: u.userId }, { content: `${apiOrigin()}/invite/${code}` })
}

function TextEditor({ editor, name, onClose, onSave }: { editor: Editor; name: string; onClose: () => void; onSave: (text: string) => void }) {
  const t = useT()
  // Remonté (key) à chaque ouverture : le texte part de la valeur chargée.
  const [text, setText] = useState(editor?.text ?? '')
  return (
    <Modal visible={!!editor} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{editor?.kind === 'note' ? `🔒 ${t('ux.um.note')}` : t('ux.um.friendNick')} · {name}</Text>
          <Text style={styles.hint}>{t('ux.um.onlyYou')}</Text>
          <TextField value={text} onChangeText={setText} multiline={editor?.kind === 'note'} maxLength={editor?.kind === 'note' ? 2000 : 64} autoFocus />
          <View style={styles.buttons}>
            <Button title={t('common.cancel')} variant="ghost" onPress={onClose} />
            <Button title={t('ux.um.save')} onPress={() => onSave(text)} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

/** « Voir le code de vérification » : code de sécurité E2E partagé avec la personne, à comparer hors bande. */
function SafetyViewer({ user, onClose }: { user: UserTarget | null; onClose: () => void }) {
  const t = useT()
  return (
    <Modal visible={!!user} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{t('ux.um.safetyCode')} · {user?.name}</Text>
          {user ? <SafetyCode userId={user.userId} /> : null}
          <View style={styles.buttons}>
            <Button title={t('common.close')} variant="ghost" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  )
}

function AvatarViewer({ uri, onClose }: { uri: string | null; onClose: () => void }) {
  const t = useT()
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={!!uri} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.viewer}>
        {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" /> : null}
        <Pressable onPress={onClose} style={[styles.closeBtn, { top: insets.top + spacing.md }]} accessibilityRole="button" accessibilityLabel={t('common.close')} hitSlop={12}>
          <Ionicons name="close" size={28} color="#fff" />
        </Pressable>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: spacing.xl },
  card: { backgroundColor: colors.bgAlt, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  title: { color: colors.text, fontSize: font.md, fontWeight: '700' },
  hint: { color: colors.textMuted, fontSize: font.xs },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  viewer: { flex: 1, backgroundColor: '#000' },
  closeBtn: { position: 'absolute', right: spacing.lg },
})
