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
  author_is_bot: boolean
  author_verified?: boolean
  attachments: Attachment[]
  reactions: Reaction[]
  poll_id?: string | null
  expires_at?: string | null
}

/** Message privé 1:1 (handlers/friends.rs::get_dm_messages). */
export interface DmMessage {
  id: string
  content: string | null
  created_at: string
  sender_id: string
  sender_username: string
  sender_avatar: string | null
  edited_at?: string | null
  reply_to_id?: string | null
  reply_to?: { id: string; content: string | null; sender_id: string; sender_username: string } | null
  attachments?: Attachment[]
  reactions?: Reaction[]
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
  reply_to?: string | null
  reply_to_username?: string | null
  reply_to_content?: string | null
  attachments?: Attachment[]
  reactions?: Reaction[]
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
  /** Message éphémère (salons uniquement) : disparaît à cette date. */
  expiresAt?: string | null
  /** Sondage attaché (salons uniquement). */
  pollId?: string | null
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
  status?: UserStatus
  nickname?: string | null
  is_owner?: boolean
  role_ids?: string[]
  timeout_until?: string | null
}

export interface Session {
  id: string
  device: string | null
  ip: string | null
  last_seen: string
  created_at: string
}

export interface UnreadItem {
  channel_id: string
  server_id: string | null
  count: number
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
}

export interface InviteInfo {
  code: string
  server: { id: string; name: string; icon: string | null; member_count: number }
}
