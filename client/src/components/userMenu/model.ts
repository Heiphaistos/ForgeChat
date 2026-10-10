// Entrées des menus contextuels « comme Discord » (utilisateur, conversation privée), sans
// React : chaque appelant fournit les faits et les actions, ce module décide quoi montrer et
// dans quel ordre. Testé par scripts/uxMenus.test.mjs.
import type { ContextMenuEntry, ContextMenuItem } from '../ui/ContextMenu'
import type { Key } from '../../i18n/fr'

export type Tr = (key: Key, vars?: Record<string, string | number>) => string

/** Durées du menu « Rendre muet » en minutes ; 0 = jusqu'à réactivation. */
export const MUTE_MINUTES = [15, 60, 180, 480, 1440, 0] as const

export type Relation = 'self' | 'friend' | 'incoming' | 'outgoing' | 'none'

export interface UserMenuFacts {
  name: string
  relation: Relation
  favorite: boolean
  blocked: boolean
  ignored: boolean
  /** Une zone de saisie est ouverte : « Mentionner » l'y insère. */
  canMention: boolean
  /** Conversation privée existante avec cette personne. */
  dm: { muted: boolean } | null
  /** Serveurs où je peux inviter cette personne. */
  inviteServers: { id: string; name: string }[]
  friendGroups: { id: string; name: string; member: boolean }[]
  /** Entrées déjà prêtes : volume (en vocal), support à distance, modération. */
  volume: ContextMenuItem | null
  support: ContextMenuItem | null
  moderation: ContextMenuEntry[]
}

export interface UserMenuActions {
  profile(): void
  message(): void
  call(): void
  note(): void
  mention(): void
  invite(serverId: string): void
  addFriend(): void
  acceptFriend(): void
  removeFriend(): void
  favorite(on: boolean): void
  group(groupId: string, on: boolean): void
  ignore(on: boolean): void
  block(on: boolean): void
  mute(minutes: number): void
  unmute(): void
  viewAvatar(): void
  copyUrl(): void
  copyId(): void
}

const SEP: ContextMenuEntry = { separator: true }
const isSep = (e: ContextMenuEntry) => 'separator' in e && e.separator === true

/** Retire les séparateurs en tête, en fin et en double. */
export function tidy(entries: ContextMenuEntry[]): ContextMenuEntry[] {
  const out: ContextMenuEntry[] = []
  for (const e of entries) {
    if (isSep(e) && (out.length === 0 || isSep(out[out.length - 1]))) continue
    out.push(e)
  }
  while (out.length && isSep(out[out.length - 1])) out.pop()
  return out
}

export function muteSubmenu(t: Tr, onMute: (minutes: number) => void): ContextMenuEntry[] {
  return MUTE_MINUTES.map(m => ({ label: t(`um.mute.${m}` as Key), onClick: () => onMute(m) }))
}

export function buildUserMenu(f: UserMenuFacts, a: UserMenuActions, t: Tr): ContextMenuEntry[] {
  const self = f.relation === 'self'
  const friend = f.relation === 'friend'
  const entries: ContextMenuEntry[] = [
    { label: t('um.profile'), onClick: a.profile },
    ...(self ? [] : [
      { label: t('msg.sendMessage'), onClick: a.message },
      { label: t('um.call'), onClick: a.call },
    ]),
    { label: t('um.note'), hint: t('um.onlyYou'), onClick: a.note },
    ...(friend ? [{ label: t('um.friendNick'), hint: t('um.onlyYou'), onClick: a.note }] : []),
    SEP,
    ...(f.volume ? [f.volume] : []),
    ...(f.canMention ? [{ label: t('members.mention'), onClick: a.mention }] : []),
    SEP,
    ...(self ? [] : [
      ...(f.support ? [f.support] : []),
      ...(f.inviteServers.length ? [{
        label: t('um.invite'),
        submenu: f.inviteServers.map(s => ({ label: s.name, onClick: () => a.invite(s.id) })),
      }] : []),
      friend ? { label: t('um.removeFriend'), onClick: a.removeFriend }
        : f.relation === 'incoming' ? { label: t('um.acceptFriend'), onClick: a.acceptFriend }
        : f.relation === 'outgoing' ? { label: t('um.requestSent'), disabled: true }
        : { label: t('um.addFriend'), onClick: a.addFriend, disabled: f.blocked },
      ...(friend ? [{ label: t(f.favorite ? 'um.unfavorite' : 'um.favorite'), onClick: () => a.favorite(!f.favorite) }] : []),
      ...(friend && f.friendGroups.length ? [{
        label: t('um.groups'),
        submenu: f.friendGroups.map(g => ({ label: g.name, checked: g.member, onClick: () => a.group(g.id, !g.member) })),
      }] : []),
      ...(f.dm ? [f.dm.muted
        ? { label: t('um.unmute', { name: f.name }), onClick: a.unmute }
        : { label: t('um.mute', { name: f.name }), submenu: muteSubmenu(t, a.mute) }] : []),
      SEP,
      { label: t(f.ignored ? 'um.unignore' : 'um.ignore'), hint: t('um.ignoreHint'), onClick: () => a.ignore(!f.ignored) },
      { label: t(f.blocked ? 'friends.unblock' : 'friends.block'), danger: !f.blocked, onClick: () => a.block(!f.blocked) },
    ]),
    ...f.moderation,
    SEP,
    { label: t('um.viewAvatar'), onClick: a.viewAvatar },
    { label: t('um.copyUrl'), onClick: a.copyUrl },
    { label: t('um.copyId'), onClick: a.copyId },
  ]
  return tidy(entries)
}

export interface ConvFacts {
  group: boolean
  pinned: boolean
  muted: boolean
  unread: boolean
}

export interface ConvActions {
  markRead(): void
  pin(on: boolean): void
  mute(minutes: number): void
  unmute(): void
  close(): void
  leave(): void
  copyId(): void
}

/**
 * Clic droit sur une conversation de la liste : actions de la conversation, puis (MP) le menu
 * de la personne — qui porte déjà « Rendre muet » et les favoris — et enfin la fermeture.
 */
export function buildConvMenu(c: ConvFacts, a: ConvActions, t: Tr, userEntries: ContextMenuEntry[] = []): ContextMenuEntry[] {
  return tidy([
    { label: t('channels.markRead'), onClick: a.markRead, disabled: !c.unread },
    { label: t(c.pinned ? 'dml.unpin' : 'dml.pin'), onClick: () => a.pin(!c.pinned) },
    ...(c.group ? [c.muted
      ? { label: t('dml.unmuteGroup'), onClick: a.unmute }
      : { label: t('dml.muteGroup'), submenu: muteSubmenu(t, a.mute) }] : []),
    SEP,
    ...userEntries,
    SEP,
    { label: t(c.group ? 'dml.closeGroup' : 'dml.close'), hint: t('dml.closeHint'), onClick: a.close },
    ...(c.group ? [{ label: t('dms.leaveGroup'), danger: true, onClick: a.leave }] : []),
    SEP,
    { label: t('dml.copyId'), onClick: a.copyId },
  ])
}

/** Ordre de la liste : épinglées d'abord, l'ordre reçu (le plus récent) sinon. */
export function pinnedFirst<T extends { is_pinned?: boolean }>(list: readonly T[]): T[] {
  return [...list.filter(d => d.is_pinned), ...list.filter(d => !d.is_pinned)]
}
