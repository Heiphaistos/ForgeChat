// Entrées des menus d'appui long « comme Discord » (personne, conversation privée), sans React :
// l'appelant fournit les faits, ce module décide quoi montrer et dans quel ordre. Même ordre que
// le web (client/src/components/userMenu/model.ts, branche ux-menus). Testé par __tests__/user-menu.test.ts.

/** Durées de « Rendre muet » en minutes ; 0 = jusqu'à réactivation (mêmes que le web). */
export const MUTE_MINUTES = [15, 60, 180, 480, 1440, 0] as const

export type RelationKind = 'self' | 'friend' | 'received' | 'sent' | 'blocked' | 'none'

export type UserAction =
  | 'profile' | 'message' | 'call' | 'note' | 'friendNick' | 'volume'
  | 'voiceMute' | 'soundboardMute' | 'videoOff' | 'safetyCode' | 'invite'
  | 'addFriend' | 'acceptFriend' | 'removeFriend' | 'favorite' | 'unfavorite'
  | 'mute' | 'unmute' | 'ignore' | 'unignore' | 'block' | 'unblock'
  | 'roles' | 'moveTo' | 'serverMute' | 'serverDeafen' | 'disconnect' | 'kick' | 'ban' | 'timeout'
  | 'nickname' | 'viewAvatar' | 'copyId'

export type ConvAction = 'markRead' | 'pin' | 'unpin' | 'muteGroup' | 'unmuteGroup' | 'archive' | 'unarchive' | 'close' | 'leave' | 'copyConvId'

/** Modération permise sur la personne (perms.ts) ; `inVoice` : elle est dans un salon vocal du serveur. */
export interface ModFacts {
  roles: boolean
  move: boolean
  mute: boolean
  deafen: boolean
  inVoice: boolean
  kick: boolean
  ban: boolean
  timeout: boolean
  /** Changer son pseudo : le mien (écran du pseudo) ou le sien avec « Gérer les pseudos » et un rang supérieur. */
  nickname: boolean
}

export interface UserFacts {
  relation: RelationKind
  favorite: boolean
  ignored: boolean
  /** Conversation privée existante avec cette personne (sourdine du MP). */
  dm: { muted: boolean } | null
  /** Au moins un serveur où l'inviter. */
  canInvite: boolean
  /** Ouvert depuis un salon vocal ou un appel : volume, muet / soundboard / vidéo pour moi seul. */
  volume: boolean
  hasAvatar: boolean
  /** Ouvert depuis un serveur où j'ai des droits sur elle ; null sinon. */
  mod?: ModFacts | null
}

/** Même ordre que le web : personne, vocal local, code de vérification, relation, modération, copie. */
export function buildUserMenu(f: UserFacts): UserAction[] {
  const self = f.relation === 'self'
  const friend = f.relation === 'friend'
  const voice = f.volume && !self
  const m = f.mod
  const out: (UserAction | false | null | undefined)[] = [
    'profile',
    !self && f.relation !== 'blocked' && 'message',
    !self && f.relation !== 'blocked' && 'call',
    !self && 'note',
    friend && 'friendNick',
    voice && 'volume',
    voice && 'voiceMute',
    voice && 'soundboardMute',
    voice && 'videoOff',
    !self && 'safetyCode',
    m?.nickname && 'nickname',
    !self && f.canInvite && f.relation !== 'blocked' && 'invite',
    friend ? 'removeFriend' : f.relation === 'received' ? 'acceptFriend' : f.relation === 'none' && 'addFriend',
    friend && (f.favorite ? 'unfavorite' : 'favorite'),
    !self && !!f.dm && (f.dm.muted ? 'unmute' : 'mute'),
    !self && (f.ignored ? 'unignore' : 'ignore'),
    !self && (f.relation === 'blocked' ? 'unblock' : 'block'),
    m?.roles && 'roles',
    m?.move && m.inVoice && 'moveTo',
    m?.mute && 'serverMute',
    m?.deafen && 'serverDeafen',
    m?.move && m.inVoice && 'disconnect',
    !self && m?.kick && 'kick',
    !self && m?.ban && 'ban',
    !self && m?.timeout && 'timeout',
    f.hasAvatar && 'viewAvatar',
    'copyId',
  ]
  return out.filter((a): a is UserAction => !!a)
}

export interface ConvFacts {
  group: boolean
  pinned: boolean
  muted: boolean
  archived: boolean
  unread: boolean
}

/** Appui long sur une conversation : ses actions ; pour un MP, le menu de la personne suit (UserMenuHost). */
export function buildConvMenu(c: ConvFacts): ConvAction[] {
  const out: (ConvAction | false)[] = [
    c.unread && 'markRead',
    c.pinned ? 'unpin' : 'pin',
    c.group && (c.muted ? 'unmuteGroup' : 'muteGroup'),
    c.archived ? 'unarchive' : 'archive',
    'close',
    c.group && 'leave',
    'copyConvId',
  ]
  return out.filter((a): a is ConvAction => !!a)
}

/** Ordre de la liste : épinglées d'abord, l'ordre reçu (le plus récent) sinon. */
export function pinnedFirst<T>(list: readonly T[], isPinned: (c: T) => boolean): T[] {
  return [...list.filter(isPinned), ...list.filter((c) => !isPinned(c))]
}

/** Conversation fermée encore masquée : aucun message arrivé depuis sa fermeture. */
export const stillClosed = (closedAt: number | undefined, lastMessageAt: string | null) =>
  closedAt !== undefined && (!lastMessageAt || Date.parse(lastMessageAt) <= closedAt)
