import type { Role, ServerDetail } from '@/types/models'

/** Bits de permission, identiques à server/src/models/role.rs (STREAM = bit 40 : au-delà des entiers 32 bits). */
export const PERM = {
  VIEW_CHANNEL: 2 ** 0,
  SEND_MESSAGES: 2 ** 1,
  READ_HISTORY: 2 ** 2,
  MANAGE_MESSAGES: 2 ** 3,
  MANAGE_CHANNELS: 2 ** 4,
  MANAGE_ROLES: 2 ** 5,
  KICK_MEMBERS: 2 ** 6,
  BAN_MEMBERS: 2 ** 7,
  MANAGE_SERVER: 2 ** 8,
  MENTION_EVERYONE: 2 ** 9,
  ATTACH_FILES: 2 ** 10,
  EMBED_LINKS: 2 ** 11,
  ADD_REACTIONS: 2 ** 12,
  CONNECT_VOICE: 2 ** 13,
  SPEAK_VOICE: 2 ** 14,
  MUTE_MEMBERS: 2 ** 15,
  DEAFEN_MEMBERS: 2 ** 16,
  MOVE_MEMBERS: 2 ** 17,
  PRIORITY_SPEAKER: 2 ** 18,
  CREATE_CHANNELS: 2 ** 19,
  EDIT_CHANNELS: 2 ** 20,
  DELETE_CHANNELS: 2 ** 21,
  DELETE_OWN_CHANNELS: 2 ** 22,
  BAN_TEMP: 2 ** 23,
  ADMINISTRATOR: 2 ** 31,
  STREAM: 2 ** 40,
} as const

/** Libellés des cases à cocher (mêmes groupes que client/src/components/modals/RolesTab.tsx). */
export const PERMISSION_GROUPS: { label: string; perms: { bit: number; label: string }[] }[] = [
  {
    label: 'Administration',
    perms: [
      { bit: PERM.ADMINISTRATOR, label: 'Administrateur' },
      { bit: PERM.MANAGE_SERVER, label: 'Gérer le serveur' },
      { bit: PERM.MANAGE_ROLES, label: 'Gérer les rôles' },
      { bit: PERM.MANAGE_CHANNELS, label: 'Gérer les salons' },
      { bit: PERM.CREATE_CHANNELS, label: 'Créer des salons' },
      { bit: PERM.EDIT_CHANNELS, label: 'Modifier les salons' },
      { bit: PERM.DELETE_CHANNELS, label: 'Supprimer tous les salons' },
      { bit: PERM.DELETE_OWN_CHANNELS, label: 'Supprimer ses propres salons' },
    ],
  },
  {
    label: 'Gestion des membres',
    perms: [
      { bit: PERM.KICK_MEMBERS, label: 'Expulser des membres' },
      { bit: PERM.BAN_MEMBERS, label: 'Bannir définitivement' },
      { bit: PERM.BAN_TEMP, label: 'Bannir temporairement' },
    ],
  },
  {
    label: 'Salons texte',
    perms: [
      { bit: PERM.VIEW_CHANNEL, label: 'Voir les salons' },
      { bit: PERM.READ_HISTORY, label: "Lire l'historique" },
      { bit: PERM.SEND_MESSAGES, label: 'Envoyer des messages' },
      { bit: PERM.MANAGE_MESSAGES, label: 'Gérer les messages (et exclure temporairement)' },
      { bit: PERM.MENTION_EVERYONE, label: 'Mentionner @everyone' },
      { bit: PERM.ATTACH_FILES, label: 'Joindre des fichiers' },
      { bit: PERM.EMBED_LINKS, label: 'Intégrer des liens' },
      { bit: PERM.ADD_REACTIONS, label: 'Ajouter des réactions' },
    ],
  },
  {
    label: 'Vocal et vidéo',
    perms: [
      { bit: PERM.CONNECT_VOICE, label: 'Rejoindre la voix' },
      { bit: PERM.SPEAK_VOICE, label: 'Parler' },
      { bit: PERM.STREAM, label: "Partager l'écran / la caméra" },
      { bit: PERM.PRIORITY_SPEAKER, label: 'Orateur prioritaire' },
      { bit: PERM.MUTE_MEMBERS, label: 'Rendre muet' },
      { bit: PERM.DEAFEN_MEMBERS, label: 'Rendre sourd' },
      { bit: PERM.MOVE_MEMBERS, label: 'Déplacer des membres' },
    ],
  },
]

// BigInt : les opérateurs bit à bit de JS tronquent à 32 bits (STREAM serait perdu).
export const hasBit = (perms: number, mask: number) => (BigInt(Math.trunc(perms)) & BigInt(mask)) !== 0n
export const toggleBit = (perms: number, bit: number) => Number(BigInt(Math.trunc(perms)) ^ BigInt(bit))

/** Couleur d'un rôle (entier RVB) en « #rrggbb » ; 0 = sans couleur. */
export const roleColorHex = (c: number) => (c ? `#${(c >>> 0).toString(16).padStart(6, '0')}` : null)

export interface MemberRank {
  user_id: string
  is_owner?: boolean
  role_ids?: string[]
}

export type ServerPerms = ReturnType<typeof serverPerms>

/**
 * Permissions de l'utilisateur, calculées depuis GET /servers/:id comme client/src/hooks/useServerPerms.ts
 * (rôles + @everyone, propriétaire, ADMINISTRATOR, hiérarchie de `require_outranks`). Sert à n'afficher
 * que ce qui est autorisé ; le serveur reste seul juge.
 */
export function serverPerms(detail: ServerDetail | undefined, meId: string | undefined) {
  const roles: Role[] = detail?.roles ?? []
  const mine = new Set(detail?.my_role_ids ?? [])
  const perms = roles.filter((r) => r.is_everyone || mine.has(r.id)).reduce((acc, r) => acc | BigInt(Math.trunc(r.permissions)), 0n)
  const ownerId = detail?.server.owner_id
  const isOwner = !!meId && ownerId === meId
  const isAdmin = isOwner || (perms & BigInt(PERM.ADMINISTRATOR)) !== 0n
  /** Au moins un des bits de `mask`. */
  const has = (mask: number) => isAdmin || (perms & BigInt(mask)) !== 0n
  const topPosition = (ids: Iterable<string>) => {
    const set = new Set(ids)
    return roles.reduce((top, r) => (!r.is_everyone && set.has(r.id) ? Math.max(top, r.position) : top), -1)
  }
  const myTop = topPosition(mine)
  return {
    loaded: !!detail,
    meId,
    ownerId,
    isOwner,
    isAdmin,
    has,
    /** Le serveur pose des questions d'accueil (modifiables par chaque membre). */
    hasOnboarding: !!detail?.member?.has_onboarding,
    /** Strictement au-dessus de la cible ; le propriétaire n'est jamais une cible. */
    outranks: (target: MemberRank) => {
      if (target.is_owner || target.user_id === ownerId || target.user_id === meId) return false
      return isOwner || myTop > topPosition(target.role_ids ?? [])
    },
    /** `require_role_below` : seul le propriétaire touche un rôle égal ou supérieur au sien (@everyone, position 0, compris). */
    roleBelow: (role: Role) => isOwner || role.position < myTop,
    canCreateChannels: has(PERM.MANAGE_CHANNELS | PERM.CREATE_CHANNELS),
    canEditChannels: has(PERM.MANAGE_CHANNELS | PERM.EDIT_CHANNELS),
    /** `deletion_refusal` (channel_access.rs) : ce que le propriétaire a créé n'est supprimable que par lui ou un admin. */
    canDeleteChannel: (createdBy?: string | null) => {
      if (isAdmin) return true
      if (createdBy && createdBy === ownerId) return false
      if (has(PERM.MANAGE_CHANNELS | PERM.DELETE_CHANNELS)) return true
      return has(PERM.DELETE_OWN_CHANNELS) && !!createdBy && createdBy === meId
    },
  }
}

/** Actions de modération proposées sur un membre (mêmes gardes que kick/ban/timeout/assign_role côté serveur). */
export function memberActions(p: ServerPerms, target: MemberRank) {
  const above = p.outranks(target)
  return {
    /** Attribuer / retirer des rôles (en plus, chaque rôle doit être sous le sien : `roleBelow`). */
    roles: p.has(PERM.MANAGE_ROLES) && (target.user_id === p.meId || above),
    kick: above && p.has(PERM.KICK_MEMBERS),
    ban: above && p.has(PERM.BAN_MEMBERS | PERM.BAN_TEMP),
    banForever: above && p.has(PERM.BAN_MEMBERS),
    timeout: above && p.has(PERM.MANAGE_MESSAGES),
  }
}

export type ServerMenuKey =
  | 'read'
  | 'invite'
  | 'notifications'
  | 'events'
  | 'boost'
  | 'createChannel'
  | 'createCategory'
  | 'settings'
  | 'nickname'
  | 'onboarding'
  | 'copyId'
  | 'leave'
  | 'delete'

export type SettingsSection =
  | 'overview'
  | 'advanced'
  | 'channels'
  | 'roles'
  | 'tags'
  | 'members'
  | 'reports'
  | 'bans'
  | 'invites'
  | 'emojis'
  | 'webhooks'
  | 'audit'
  | 'automod'
  | 'stats'
  | 'onboarding'
  | 'danger'

/** Rubriques des paramètres du serveur, d'après les gardes des routes Rust correspondantes. */
export function settingsSections(p: ServerPerms): SettingsSection[] {
  if (!p.loaded) return []
  const out: SettingsSection[] = []
  const manageServer = p.has(PERM.MANAGE_SERVER)
  // PATCH /servers/:id et /verification : require_owner
  if (p.isOwner) out.push('overview', 'advanced')
  if (p.canEditChannels || p.has(PERM.DELETE_CHANNELS | PERM.DELETE_OWN_CHANNELS)) out.push('channels')
  if (p.has(PERM.MANAGE_ROLES)) out.push('roles', 'tags')
  const voiceMod = PERM.MUTE_MEMBERS | PERM.DEAFEN_MEMBERS | PERM.MOVE_MEMBERS
  if (p.has(PERM.MANAGE_ROLES | PERM.KICK_MEMBERS | PERM.BAN_MEMBERS | PERM.BAN_TEMP | PERM.MANAGE_MESSAGES | voiceMod)) out.push('members')
  if (p.has(PERM.BAN_MEMBERS | PERM.BAN_TEMP)) out.push('reports', 'bans') // reports.rs : BAN_MEMBERS | BAN_TEMP
  // Invitations, emojis, stickers, webhooks, audit, AutoMod, statistiques : MANAGE_SERVER
  if (manageServer) out.push('invites', 'emojis', 'webhooks', 'audit', 'automod', 'stats')
  if (p.isOwner) out.push('onboarding', 'danger') // accueil, transfert et suppression : require_owner
  return out
}

/** Entrées du menu d'un serveur (appui long sur le rail ou sur l'en-tête), dans l'ordre affiché. */
export function serverMenuKeys(p: ServerPerms): ServerMenuKey[] {
  const out: ServerMenuKey[] = ['read']
  if (p.has(PERM.MANAGE_SERVER)) out.push('invite') // POST /servers/:id/invites
  out.push('notifications')
  if (p.loaded) out.push('events') // tout membre
  if (p.canCreateChannels) out.push('createChannel', 'createCategory')
  if (settingsSections(p).length) out.push('settings')
  out.push('nickname')
  if (p.hasOnboarding) out.push('onboarding')
  if (p.loaded) out.push('boost')
  out.push('copyId')
  if (p.loaded) out.push(p.isOwner ? 'delete' : 'leave')
  return out
}
