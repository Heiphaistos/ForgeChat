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
  /** Entrées déjà prêtes : volume (curseur, en vocal), support à distance, modération. */
  volume: ContextMenuEntry | null
  support: ContextMenuItem | null
  moderation: ContextMenuEntry[]
  /**
   * Réglages « pour moi seulement » d'une personne entendue en vocal (null ailleurs ou soi-même) ;
   * soundboard et vidéo seulement dans un salon vocal de serveur (absents d'un appel privé).
   */
  voiceLocal: { muted: boolean; soundboardMuted?: boolean; videoOff?: boolean } | null
  /** Je peux changer son pseudo sur le serveur du contexte : le mien, ou le sien avec « Gérer les pseudos » et un rang supérieur. */
  canNick: boolean
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
  localMute(on: boolean): void
  soundboardMute(on: boolean): void
  videoOff(on: boolean): void
  verifyCode(): void
  nickname(): void
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
  const v = f.voiceLocal
  const entries: ContextMenuEntry[] = [
    { label: t('um.profile'), onClick: a.profile },
    ...(f.canMention ? [{ label: t('members.mention'), onClick: a.mention }] : []),
    ...(self ? [] : [
      { label: t('msg.sendMessage'), onClick: a.message },
      { label: t('um.call'), onClick: a.call },
    ]),
    { label: t('um.note'), hint: t('um.onlyYou'), onClick: a.note },
    ...(friend ? [{ label: t('um.friendNick'), hint: t('um.onlyYou'), onClick: a.note }] : []),
    SEP,
    ...(f.volume ? [f.volume] : []),
    ...(v ? [
      { label: t('um.localMute'), checked: v.muted, onClick: () => a.localMute(!v.muted) },
      ...(v.soundboardMuted === undefined ? [] : [{ label: t('um.soundboardMute'), checked: v.soundboardMuted, onClick: () => a.soundboardMute(!v.soundboardMuted) }]),
      ...(v.videoOff === undefined ? [] : [{ label: t('um.videoOff'), checked: v.videoOff, onClick: () => a.videoOff(!v.videoOff) }]),
    ] : []),
    SEP,
    ...(self ? [] : [{ label: t('um.verifyCode'), onClick: a.verifyCode }]),
    ...(f.canNick ? [{ label: t('um.changeNick'), onClick: a.nickname }] : []),
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
      { label: t(f.ignored ? 'um.unignore' : 'um.ignore'), hint: t('um.ignoreHint'), onClick: () => a.ignore(!f.ignored) },
      { label: t(f.blocked ? 'friends.unblock' : 'friends.block'), danger: !f.blocked, onClick: () => a.block(!f.blocked) },
    ]),
    ...f.moderation,
    SEP,
    { label: t('um.copyId'), onClick: a.copyId },
    { label: t('um.viewAvatar'), onClick: a.viewAvatar },
    { label: t('um.copyUrl'), onClick: a.copyUrl },
  ]
  return tidy(entries)
}

/** Pseudo d'un AUTRE membre : « Gérer les pseudos » et rang strictement supérieur (comme le serveur). */
export function canRenameMember(f: { self: boolean; manage: boolean; above: boolean }): boolean {
  return !f.self && f.manage && f.above
}

/** Ce que je peux faire au membre (permissions réelles et hiérarchie, calculées par l'appelant). */
export interface ModFacts {
  name: string
  self: boolean
  /** Je suis strictement au-dessus de lui dans la hiérarchie des rôles. */
  above: boolean
  can: { roles: boolean; mute: boolean; deafen: boolean; move: boolean; kick: boolean; ban: boolean; timeout: boolean; notes: boolean; channelPerms: boolean }
  timedOut: boolean
  serverMuted: boolean
  serverDeafened: boolean
  /** Salon vocal où il se trouve sur ce serveur. */
  currentVoice: string | null
  voiceChannels: { id: string; name: string }[]
  /** Rôles que je peux attribuer (sous le mien), cochés s'il les a. */
  roles: { id: string; name: string; has: boolean }[]
}

export interface ModActions {
  role(roleId: string, on: boolean): void
  moveTo(channelId: string): void
  permissions(): void
  serverMute(on: boolean): void
  serverDeafen(on: boolean): void
  disconnect(): void
  kick(): void
  ban(): void
  timeout(): void
  liftTimeout(): void
  notes(): void
}

/** Modération d'un membre, dans l'ordre de Discord ; rien de ce que je n'ai pas le droit de faire. */
export function buildModMenu(f: ModFacts, a: ModActions, t: Tr): ContextMenuEntry[] {
  const reach = f.self || f.above
  const others = f.voiceChannels.filter(c => c.id !== f.currentVoice)
  const inVoice = f.currentVoice !== null
  const items: ContextMenuEntry[] = [
    ...(reach && f.can.roles && f.roles.length ? [{
      label: t('mod.roles'),
      submenu: f.roles.map(r => ({ label: r.name, checked: r.has, onClick: () => a.role(r.id, !r.has) })),
    }] : []),
    ...(reach && f.can.move && inVoice && others.length ? [{
      label: t('mod.moveToMenu'),
      submenu: others.map(c => ({ label: c.name, onClick: () => a.moveTo(c.id) })),
    }] : []),
    ...(f.can.channelPerms && inVoice ? [{ label: t('mod.channelPerms'), onClick: a.permissions }] : []),
    ...(reach && f.can.mute ? [{ label: t('mod.serverMute'), checked: f.serverMuted, danger: true, onClick: () => a.serverMute(!f.serverMuted) }] : []),
    ...(reach && f.can.deafen ? [{ label: t('mod.serverDeafen'), checked: f.serverDeafened, danger: true, onClick: () => a.serverDeafen(!f.serverDeafened) }] : []),
    ...(reach && f.can.move && inVoice ? [{ label: t('mod.disconnect'), danger: true, onClick: a.disconnect }] : []),
    ...(!f.self && f.above && f.can.kick ? [{ label: t('mod.kickName', { name: f.name }), danger: true, onClick: a.kick }] : []),
    ...(!f.self && f.above && f.can.ban ? [{ label: t('mod.banName', { name: f.name }), danger: true, onClick: a.ban }] : []),
    ...(!f.self && f.above && f.can.timeout ? [f.timedOut
      ? { label: t('mod.liftTimeout'), onClick: a.liftTimeout }
      : { label: t('mod.timeout'), onClick: a.timeout }] : []),
    ...(!f.self && f.can.notes ? [{ label: t('mod.notes'), onClick: a.notes }] : []),
  ]
  return items.length ? [SEP, ...items] : []
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
  archive(): void
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
    { label: t('dms.archive'), onClick: a.archive },
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
