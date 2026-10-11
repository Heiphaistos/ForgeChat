// Entrées des menus d'appui long « comme Discord » (personne, conversation privée), sans React :
// l'appelant fournit les faits, ce module décide quoi montrer et dans quel ordre. Même ordre que
// le web (client/src/components/userMenu/model.ts, branche ux-menus). Testé par __tests__/user-menu.test.ts.

/** Durées de « Rendre muet » en minutes ; 0 = jusqu'à réactivation (mêmes que le web). */
export const MUTE_MINUTES = [15, 60, 180, 480, 1440, 0] as const

export type RelationKind = 'self' | 'friend' | 'received' | 'sent' | 'blocked' | 'none'

export type UserAction =
  | 'profile' | 'message' | 'call' | 'note' | 'friendNick' | 'volume' | 'invite'
  | 'addFriend' | 'acceptFriend' | 'removeFriend' | 'favorite' | 'unfavorite'
  | 'mute' | 'unmute' | 'ignore' | 'unignore' | 'block' | 'unblock' | 'viewAvatar' | 'copyId'

export type ConvAction = 'markRead' | 'pin' | 'unpin' | 'muteGroup' | 'unmuteGroup' | 'archive' | 'unarchive' | 'close' | 'leave' | 'copyConvId'

export interface UserFacts {
  relation: RelationKind
  favorite: boolean
  ignored: boolean
  /** Conversation privée existante avec cette personne (sourdine du MP). */
  dm: { muted: boolean } | null
  /** Au moins un serveur où l'inviter. */
  canInvite: boolean
  /** Ouvert depuis un salon vocal ou un appel : réglage du volume de la personne. */
  volume: boolean
  hasAvatar: boolean
}

export function buildUserMenu(f: UserFacts): UserAction[] {
  const self = f.relation === 'self'
  const friend = f.relation === 'friend'
  const out: (UserAction | false)[] = [
    'profile',
    !self && f.relation !== 'blocked' && 'message',
    !self && f.relation !== 'blocked' && 'call',
    !self && 'note',
    friend && 'friendNick',
    f.volume && !self && 'volume',
    !self && f.canInvite && f.relation !== 'blocked' && 'invite',
    friend ? 'removeFriend' : f.relation === 'received' ? 'acceptFriend' : f.relation === 'none' && 'addFriend',
    friend && (f.favorite ? 'unfavorite' : 'favorite'),
    !self && !!f.dm && (f.dm.muted ? 'unmute' : 'mute'),
    !self && (f.ignored ? 'unignore' : 'ignore'),
    !self && (f.relation === 'blocked' ? 'unblock' : 'block'),
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
