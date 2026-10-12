import type { LinkPreviewData } from '@/features/chat/messageExtras'
import type { NameStyle } from '@/lib/nameStyle'

/**
 * Modèles de données, alignés sur les réponses JSON du serveur Rust
 * (server/src/models/*.rs et handlers/*.rs).
 */

export type UserStatus = 'online' | 'idle' | 'away' | 'dnd' | 'invisible' | 'offline' | (string & {})

export interface User {
  id: string
  username: string
  discriminator: string
  avatar: string | null
  banner: string | null
  bio: string | null
  status: UserStatus
  custom_status: string | null
  custom_status_emoji?: string | null
  activity_type?: string | null
  activity_name?: string | null
  activity_detail?: string | null
  focus_mode?: boolean
  verified?: boolean
  totp_enabled?: boolean
  pronouns?: string | null
  created_at?: string
  /** Personnalisation du profil (migration 081). */
  avatar_decoration?: string | null
  profile_color_primary?: number | null
  profile_color_accent?: number | null
  profile_effect?: string | null
  /** Pseudo personnalisé (migration 088) : voir lib/nameStyle. */
  display_name?: string | null
  name_style?: NameStyle | null
  profile_tag?: string | null
  profile_links?: ProfileLink[] | null
  custom_status_expires_at?: string | null
}

export interface ProfileLink {
  label: string
  url: string
}

export interface AuthResponse {
  access_token: string
  refresh_token: string
  user: User
}

export interface Server {
  id: string
  name: string
  icon: string | null
  banner: string | null
  description: string | null
  owner_id: string
  member_count: number
  is_public: boolean
  system_channel_id: string | null
  rules_channel_id: string | null
  boost_level?: number
  /** La couleur des rôles remplace la couleur perso du pseudo (défaut true). */
  role_color_overrides_name?: boolean
}

export type ChannelType =
  | 'text'
  | 'voice'
  | 'video'
  | 'announcement'
  | 'forum'
  | 'media'
  | 'stage'
  | (string & {})

export interface Channel {
  id: string
  server_id: string | null
  category_id: string | null
  name: string
  type: ChannelType
  topic: string | null
  position: number
  is_nsfw: boolean
  slowmode_delay: number
  user_limit: number | null
  has_voice_password?: boolean
  archived?: boolean
  hidden?: boolean
  /** Créateur : règle de suppression (channel_access::deletion_refusal). */
  created_by?: string | null
  /** Messages éphémères du salon (secondes, null = désactivés). */
  disappear_seconds?: number | null
  /** Fils automatiques : chaque message ouvre son fil. */
  auto_threads?: boolean
}

export interface Category {
  id: string
  server_id: string
  name: string
  position: number
  created_by?: string | null
}

/** Rôle de serveur (models/role.rs). `permissions` : masque de bits, jusqu'au bit 40. */
export interface Role {
  id: string
  server_id: string
  name: string
  color: number
  permissions: number
  position: number
  mentionable: boolean
  hoisted: boolean
  is_everyone: boolean
  /** Seconde couleur du dégradé de pseudo (le mobile n'affiche que la première). */
  secondary_color?: number | null
  /** Emoji ou image `/uploads/role-icon-…`. */
  icon?: string | null
}

/** Réponse de GET /servers/:id (handlers/servers.rs::get_server). */
export interface ServerDetail {
  server: Server
  channels: Channel[]
  roles: Role[]
  current_user_id: string
  my_role_ids: string[]
  /** Mon adhésion : barrière de vérification et onboarding (questions d'accueil). */
  member?: { verified_at: string | null; has_onboarding?: boolean; onboarding_pending?: boolean } | null
  /** Serveur verrouillé (modération ou anti-raid) : seul le staff écrit. */
  lockdown?: boolean
}

export interface Ban {
  user_id: string
  username: string
  discriminator: string
  avatar: string | null
  reason: string | null
  banned_at: string
  expires_at: string | null
}

export interface Invite {
  code: string
  uses: number
  max_uses: number | null
  expires_at: string | null
  created_at: string
}

export interface Attachment {
  id: string
  url: string
  filename: string
  content_type: string
  size: number
  expires_at?: string | null
}

export interface Reaction {
  emoji: string
  count: number
  me: boolean
  /** Super réaction (salons) : pastille à part de la réaction normale du même emoji. */
  is_super?: boolean
}

/** Message de salon serveur (MessageWithAuthor côté Rust). */
export interface ServerMessage {
  id: string
  channel_id: string
  content: string | null
  type: string
  reply_to: string | null
  reply_to_content: string | null
  reply_to_username: string | null
  forward_from_id?: string | null
  forward_from_username?: string | null
  pinned: boolean
  edited_at: string | null
  created_at: string
  author_id: string
  author_username: string
  author_discriminator: string
  author_avatar: string | null
  author_avatar_decoration?: string | null
  author_is_bot: boolean
  author_verified?: boolean
  attachments: Attachment[]
  reactions: Reaction[]
  poll_id?: string | null
  expires_at?: string | null
  client_msg_id?: string | null
  /** Texte en clair (bot, webhook, système, ancien message, membre sans clé). */
  unencrypted?: boolean
  /** Posés par e2e/conversations.openRaw ; `e2e_body.p` = aperçu de lien de l'expéditeur. */
  e2e?: 'ok' | 'locked'
  e2e_body?: { t: string; p?: unknown }
  /** Message système (bienvenue : numéro de membre ; starboard : référence au message). */
  system_meta?: Record<string, unknown> | null
}

/** Message privé 1:1 (handlers/friends.rs::get_dm_messages). */
export interface DmMessage {
  id: string
  content: string | null
  created_at: string
  sender_id: string
  sender_username: string
  sender_avatar: string | null
  sender_avatar_decoration?: string | null
  edited_at?: string | null
  reply_to_id?: string | null
  reply_to?: { id: string; content: string | null; sender_id: string; sender_username: string } | null
  attachments?: Attachment[]
  reactions?: Reaction[]
  client_msg_id?: string | null
  /** Posé par e2e/conversations.openRaw. */
  e2e?: 'ok' | 'locked'
  /** Messages éphémères (réglage de la conversation). */
  expires_at?: string | null
  expire_on_read?: boolean
}

/** Message de groupe privé (handlers/group_dms.rs). */
export interface GroupMessage {
  id: string
  content: string | null
  created_at: string
  edited_at?: string | null
  sender_id: string
  sender_username: string
  sender_avatar: string | null
  sender_avatar_decoration?: string | null
  reply_to?: string | null
  reply_to_username?: string | null
  reply_to_content?: string | null
  attachments?: Attachment[]
  reactions?: Reaction[]
  client_msg_id?: string | null
  /** Posé par e2e/conversations.openRaw. */
  e2e?: 'ok' | 'locked'
  expires_at?: string | null
  expire_on_read?: boolean
}

/** Représentation unifiée utilisée par l'UI de chat. */
export interface ChatMessage {
  id: string
  content: string | null
  createdAt: string
  editedAt: string | null
  authorId: string
  authorName: string
  authorAvatar: string | null
  authorDecoration?: string | null
  authorIsBot: boolean
  reply: { id: string | null; authorName: string | null; content: string | null } | null
  forwardedFrom: string | null
  attachments: Attachment[]
  reactions: Reaction[]
  pinned: boolean
  /** Envoi optimiste en cours / échoué */
  pending?: boolean
  failed?: boolean
  /** Pièces jointes annoncées mais pas encore reçues */
  awaitingAttachments?: boolean
  /** Message éphémère : disparaît à cette date. */
  expiresAt?: string | null
  /** MP ou groupe « après lecture » : disparaît 5 minutes après lecture par tous. */
  expireOnRead?: boolean
  /** Sondage attaché (salons uniquement). */
  pollId?: string | null
  /** MP/groupe chiffré : id client lié à l'AAD (réutilisé à l'édition). */
  clientMsgId?: string | null
  /** Message chiffré : déchiffré sur l'appareil ('ok') ou en attente d'une clé ('locked'). */
  e2e?: 'ok' | 'locked'
  /** Fichiers chiffrés décrits dans le message déchiffré (clés, noms, types : §12). */
  files?: import('@/e2e/crypto').FileEntry[]
  /** Message en clair (badge « non chiffré »), calculé sur l'appareil (features/chat/adapters.ts). */
  unencrypted?: boolean
  /** MP ou groupe : texte en clair là où tout est chiffré (alerte appuyée). */
  unencryptedWarn?: boolean
  /** Message chiffré : aperçu de lien calculé par l'expéditeur (jamais demandé au serveur). */
  preview?: LinkPreviewData | null
  /** Message système du lot communauté : carte de bienvenue ou référence du starboard. */
  system?: { kind: 'welcome' | 'starboard'; meta: Record<string, unknown> }
  /** MP : carte « Support à distance » (contenu chiffré `rs`, validé). */
  support?: import('@/lib/remoteSupport').SupportPayload | null
}

export type ConversationRef =
  | { kind: 'channel'; serverId: string; channelId: string }
  | { kind: 'dm'; dmId: string; otherUserId?: string }
  | { kind: 'group'; groupId: string }

export interface DmSummary {
  id: string
  is_group: false
  other_user_id: string
  username: string
  discriminator: string
  avatar: string | null
  status: UserStatus
  last_message_at: string | null
  last_message_content: string | null
  /** Dernier message chiffré de bout en bout : le serveur n'en a pas le texte. */
  last_message_encrypted?: boolean
  is_muted: boolean
  is_archived: boolean
}

export interface GroupSummary {
  id: string
  is_group: true
  name: string
  member_count: number
  last_message_at: string | null
  last_message_content: string | null
  /** Dernier message chiffré de bout en bout : le serveur n'en a pas le texte. */
  last_message_encrypted?: boolean
  last_message_author?: string | null
  is_muted: boolean
  is_archived: boolean
}

export type ConversationSummary = DmSummary | GroupSummary

export interface GroupDetails {
  id: string
  name: string
  owner_id: string
  created_at: string
  members: Pick<User, 'id' | 'username' | 'discriminator' | 'avatar' | 'status'>[]
}

export interface Friend {
  id: string
  friend_id: string
  status: 'accepted' | 'pending' | 'blocked'
  direction: 'accepted' | 'sent' | 'received' | 'blocked'
  username: string
  discriminator: string
  avatar: string | null
  user_status: UserStatus
  custom_status?: string | null
  custom_nickname?: string | null
  message?: string | null
  /** Lot « Profil et social » (amis acceptés seulement). */
  is_favorite?: boolean
  birthday?: { month: number; day: number } | null
  activity_type?: string | null
  activity_name?: string | null
  in_call?: boolean
}

export interface FriendsResponse {
  friends: Friend[]
  counts: { all: number; online: number; pending: number; pending_received: number }
}

export interface Member {
  user_id: string
  username: string
  discriminator?: string
  avatar: string | null
  avatar_decoration?: string | null
  status?: UserStatus
  nickname?: string | null
  /** Profil propre à ce serveur ; `avatar` y est déjà substitué par le serveur. */
  server_banner?: string | null
  server_bio?: string | null
  is_owner?: boolean
  role_ids?: string[]
  timeout_until?: string | null
}

export interface Session {
  id: string
  device: string | null
  last_seen: string
  created_at: string
}

export interface UnreadItem {
  channel_id: string
  server_id: string | null
  count: number
  /** Dont mentions de moi (salons ; en DM le serveur compte chaque message). */
  mention_count?: number
}

export interface MentionItem {
  message_id: string
  channel_id: string
  channel_name: string
  server_id: string
  server_name: string
  author_id: string
  author_username: string
  author_avatar: string | null
  content: string | null
  created_at: string
  /** Salon chiffré : contenu à déchiffrer (clé du salon, auteur `author_id`). */
  enc?: unknown
  client_msg_id?: string | null
}

export interface InviteInfo {
  code: string
  server: { id: string; name: string; icon: string | null; member_count: number }
}
