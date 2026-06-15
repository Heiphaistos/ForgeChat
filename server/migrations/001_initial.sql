-- ForgeChat — Schéma complet v1.0.0

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Utilisateurs
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(32) NOT NULL UNIQUE,
    discriminator VARCHAR(4) NOT NULL DEFAULT '0001',
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    avatar VARCHAR(255),
    banner VARCHAR(255),
    bio TEXT,
    status VARCHAR(16) NOT NULL DEFAULT 'offline',
    custom_status TEXT,
    is_bot BOOLEAN NOT NULL DEFAULT FALSE,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX users_username_discriminator ON users (username, discriminator);

-- Refresh tokens
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Serveurs (Guilds)
CREATE TABLE servers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    icon VARCHAR(255),
    banner VARCHAR(255),
    description TEXT,
    owner_id UUID NOT NULL REFERENCES users(id),
    invite_code VARCHAR(16) UNIQUE,
    member_count INT NOT NULL DEFAULT 1,
    is_public BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Rôles
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    color INT NOT NULL DEFAULT 0,
    permissions BIGINT NOT NULL DEFAULT 0,
    position INT NOT NULL DEFAULT 0,
    mentionable BOOLEAN NOT NULL DEFAULT FALSE,
    hoisted BOOLEAN NOT NULL DEFAULT FALSE,
    is_everyone BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Membres d'un serveur
CREATE TABLE server_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    nickname VARCHAR(32),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_owner BOOLEAN NOT NULL DEFAULT FALSE,
    timed_out_until TIMESTAMPTZ,
    UNIQUE(user_id, server_id)
);

CREATE INDEX server_members_server_id ON server_members(server_id);

-- Rôles des membres
CREATE TABLE member_roles (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, server_id, role_id)
);

-- Catégories de canaux
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    position INT NOT NULL DEFAULT 0
);

-- Canaux
CREATE TABLE channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(16) NOT NULL DEFAULT 'text',
    topic TEXT,
    position INT NOT NULL DEFAULT 0,
    is_nsfw BOOLEAN NOT NULL DEFAULT FALSE,
    slowmode_delay INT NOT NULL DEFAULT 0,
    bitrate INT,
    user_limit INT,
    last_message_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX channels_server_id ON channels(server_id);

-- Messages
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    content TEXT,
    type VARCHAR(16) NOT NULL DEFAULT 'default',
    reply_to UUID REFERENCES messages(id) ON DELETE SET NULL,
    pinned BOOLEAN NOT NULL DEFAULT FALSE,
    edited_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX messages_channel_id_created ON messages(channel_id, created_at DESC);

-- Pièces jointes
CREATE TABLE attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    size BIGINT NOT NULL,
    url VARCHAR(500) NOT NULL,
    width INT,
    height INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Réactions
CREATE TABLE reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji VARCHAR(64) NOT NULL,
    UNIQUE(message_id, user_id, emoji)
);

CREATE INDEX reactions_message_id ON reactions(message_id);

-- Messages épinglés
CREATE TABLE pinned_messages (
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    pinned_by UUID REFERENCES users(id),
    pinned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (channel_id, message_id)
);

-- Canaux DM
CREATE TABLE dm_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user1_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user2_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user1_id, user2_id)
);

-- Messages DM
CREATE TABLE dm_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dm_channel_id UUID NOT NULL REFERENCES dm_channels(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES users(id),
    content TEXT,
    edited_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX dm_messages_channel_created ON dm_messages(dm_channel_id, created_at DESC);

-- Invitations
CREATE TABLE invites (
    code VARCHAR(16) PRIMARY KEY,
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    creator_id UUID REFERENCES users(id),
    uses INT NOT NULL DEFAULT 0,
    max_uses INT,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bans
CREATE TABLE bans (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    reason TEXT,
    banned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, server_id)
);

-- Permissions de canaux
CREATE TABLE channel_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    target_id UUID NOT NULL,
    target_type VARCHAR(8) NOT NULL,
    allow BIGINT NOT NULL DEFAULT 0,
    deny BIGINT NOT NULL DEFAULT 0
);

-- Statut vocal
CREATE TABLE voice_states (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
    channel_id UUID REFERENCES channels(id) ON DELETE SET NULL,
    muted BOOLEAN NOT NULL DEFAULT FALSE,
    deafened BOOLEAN NOT NULL DEFAULT FALSE,
    self_muted BOOLEAN NOT NULL DEFAULT FALSE,
    self_deafened BOOLEAN NOT NULL DEFAULT FALSE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id)
);

-- Amis
CREATE TABLE friendships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, friend_id)
);

-- Blocages
CREATE TABLE blocks (
    blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (blocker_id, blocked_id)
);
