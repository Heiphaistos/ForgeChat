// Menu utilisateur partagé (comme Discord), ouvert par openUserMenu depuis tout pseudo ou avatar :
// auteur de message, mention, membres, vocal, amis, en-tête de MP. Monté une fois dans App.
import { useState } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import api from '../../api/client'
import { useAuth } from '../../store/auth'
import { useCallStore } from '../../store/call'
import { useUxPrefs, useMyUxPrefs } from '../../store/uxPrefs'
import { useT, t as tr } from '../../i18n'
import { ContextMenu } from '../ui/ContextMenu'
import { confirm } from '../ui/ConfirmModal'
import { volumeMenuItem } from '../voice/UserVolumePopover'
import { useMemberModeration } from '../chat/MemberModeration'
import { useRemoteSupportItem } from '../chat/RemoteSupport'
import LightboxModal from '../chat/LightboxModal'
import { PERM, permsOf } from '../../hooks/useServerPerms'
import { useUserMenu } from './store'
import { buildUserMenu, type Relation } from './model'
import { blockedQuery, dmsQuery, friendGroupsQuery, friendsQuery, serversQuery } from './queries'
import { dmWith, hasComposer, insertMention, inviteToServer } from './actions'
import UserNoteDialog from './UserNoteDialog'

const failed = (e: unknown) => toast.error(
  (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? tr('um.actionFailed'))

export default function UserMenuHost() {
  const t = useT()
  const nav = useNavigate()
  const qc = useQueryClient()
  const me = useAuth(s => s.user?.id)
  const menu = useUserMenu(s => s.menu)
  const close = useUserMenu(s => s.close)
  const serverId = useUserMenu(s => s.serverId)
  const target = menu?.target
  const [dialog, setDialog] = useState<{ kind: 'note'; userId: string; username: string; friend: boolean } | { kind: 'avatar'; url: string } | null>(null)

  const open = !!menu
  const { data: friends } = useQuery({ ...friendsQuery, enabled: open })
  const { data: blocked = [] } = useQuery({ ...blockedQuery, enabled: open })
  const { data: groups = [] } = useQuery({ ...friendGroupsQuery, enabled: open })
  const { data: dms = [] } = useQuery({ ...dmsQuery, enabled: open })
  const { data: servers = [] } = useQuery({ ...serversQuery, enabled: open })
  // Inviter : serveurs où j'ai « Gérer le serveur » (droit exigé par POST /invites).
  const serverDetails = useQueries({
    queries: servers.map(s => ({
      queryKey: ['server', s.id],
      queryFn: () => api.get(`/servers/${s.id}`).then(r => r.data),
      enabled: open && !!target && target.userId !== me && s.owner_id !== me,
      staleTime: 60_000,
    })),
  })
  const moderation = useMemberModeration(serverId)
  const supportItem = useRemoteSupportItem()
  const ignored = useMyUxPrefs().ignored

  const refreshFriends = () => {
    void qc.invalidateQueries({ queryKey: ['friends'] })
    void qc.invalidateQueries({ queryKey: ['friends_blocked'] })
    void qc.invalidateQueries({ queryKey: ['friend-groups'] })
  }

  let node = null
  if (menu && target) {
    const { userId, username } = target
    const row = friends?.friends.find(f => f.friend_id === userId)
    const relation: Relation = userId === me ? 'self'
      : row?.status === 'accepted' ? 'friend'
      : row ? (row.direction === 'sent' ? 'outgoing' : 'incoming')
      : 'none'
    const dm = dms.find(d => !d.is_group && d.other_user_id === userId)
    const isBlocked = blocked.some(b => b.id === userId)
    const isIgnored = ignored.includes(userId)
    const inviteServers = servers.filter((s, i) => s.owner_id === me || permsOf(serverDetails[i]?.data, me).has(PERM.MANAGE_SERVER))
    const patchDm = (body: object, done: string) => dm && api.patch(`/dms/${dm.id}/settings`, body)
      .then(() => { void qc.invalidateQueries({ queryKey: ['dms'] }); toast.success(done) })
      .catch(failed)

    const items = buildUserMenu({
      name: username,
      relation,
      favorite: !!row?.is_favorite,
      blocked: isBlocked,
      ignored: isIgnored,
      canMention: hasComposer(),
      dm: dm ? { muted: dm.is_muted } : null,
      inviteServers,
      friendGroups: groups.map(g => ({ id: g.id, name: g.name, member: g.member_ids.includes(userId) })),
      volume: target.voice ? volumeMenuItem(userId, username, { clientX: menu.x, clientY: menu.y }) : null,
      support: supportItem(userId),
      moderation: serverId ? moderation.itemsFor(userId) : [],
    }, {
      profile: () => nav(`/users/${userId}`),
      message: () => { dmWith(userId).then(id => nav(`/dms/${id}`)).catch(() => toast.error(tr('msg.openDmFailed'))) },
      call: () => {
        dmWith(userId).then(id => {
          nav(`/dms/${id}`)
          return useCallStore.getState().startCall(id, userId, 'voice').catch(() => toast.error(tr('dm.micDenied')))
        }).catch(() => toast.error(tr('msg.openDmFailed')))
      },
      note: () => setDialog({ kind: 'note', userId, username, friend: relation === 'friend' }),
      mention: () => { insertMention(userId, username) },
      invite: sid => {
        inviteToServer(sid, userId).then(() => toast.success(tr('um.inviteSent', { name: username }))).catch(() => toast.error(tr('um.inviteFailed')))
      },
      addFriend: () => { api.post('/friends', { user_id: userId }).then(() => { toast.success(tr('um.friendAdded')); refreshFriends() }).catch(failed) },
      acceptFriend: () => { if (row) api.post(`/friends/${row.id}/accept`).then(refreshFriends).catch(failed) },
      removeFriend: () => { api.delete(`/friends/${userId}`).then(() => { toast.success(tr('um.friendRemoved')); refreshFriends() }).catch(failed) },
      favorite: on => { api.put(`/friends/${userId}/favorite`, { favorite: on }).then(refreshFriends).catch(failed) },
      group: (gid, on) => {
        (on ? api.post(`/friends/groups/${gid}/members`, { user_id: userId }) : api.delete(`/friends/groups/${gid}/members/${userId}`))
          .then(refreshFriends).catch(failed)
      },
      ignore: on => {
        useUxPrefs.getState().set('ignored', userId, on)
        toast.success(tr(on ? 'um.ignored' : 'um.unignored', { name: username }))
      },
      block: async on => {
        if (on && !(await confirm({ message: tr('um.blockConfirm', { name: username }), danger: true, confirmLabel: tr('friends.block') }))) return
        ;(on ? api.post(`/friends/block/${userId}`) : api.delete(`/friends/block/${userId}`))
          .then(() => { toast.success(tr(on ? 'um.blocked' : 'um.unblocked', { name: username })); refreshFriends() })
          .catch(failed)
      },
      mute: minutes => { void patchDm({ muted: true, mute_minutes: minutes }, tr('um.muted')) },
      unmute: () => { void patchDm({ muted: false }, tr('um.unmuted')) },
      viewAvatar: () => {
        const show = (url?: string | null) => url ? setDialog({ kind: 'avatar', url }) : toast(tr('um.noAvatar'))
        if (target.avatar) show(target.avatar)
        else qc.fetchQuery({ queryKey: ['user', userId], queryFn: () => api.get(`/users/${userId}`).then(r => r.data), staleTime: 60_000 })
          .then((u: { avatar?: string | null }) => show(u.avatar)).catch(failed)
      },
      copyUrl: () => { void navigator.clipboard.writeText(`${window.location.origin}/users/${userId}`).then(() => toast.success(tr('um.copied'))) },
      copyId: () => { void navigator.clipboard.writeText(userId).then(() => toast.success(tr('common.idCopied'))) },
    }, t)
    node = <ContextMenu x={menu.x} y={menu.y} items={target.wrap ? target.wrap(items) : items} onClose={close} />
  }

  return (
    <>
      {node}
      {moderation.node}
      {dialog?.kind === 'note' && (
        <UserNoteDialog userId={dialog.userId} username={dialog.username} isFriend={dialog.friend} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'avatar' && <LightboxModal images={[dialog.url]} initialIndex={0} onClose={() => setDialog(null)} />}
    </>
  )
}
