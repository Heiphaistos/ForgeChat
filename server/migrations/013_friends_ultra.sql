-- Notes privées sur les amis
CREATE TABLE IF NOT EXISTS friend_notes (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    note       TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, target_id)
);

-- Surnoms personnalisés pour les amis
CREATE TABLE IF NOT EXISTS friend_nicknames (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nickname   VARCHAR(64) NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, target_id)
);

-- Groupes d'amis (catégories)
CREATE TABLE IF NOT EXISTS friend_groups (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       VARCHAR(64) NOT NULL,
    color      VARCHAR(16),
    position   INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Membres des groupes d'amis
CREATE TABLE IF NOT EXISTS friend_group_members (
    group_id  UUID NOT NULL REFERENCES friend_groups(id) ON DELETE CASCADE,
    user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, user_id)
);

-- Notifications de connexion (alerter quand l'ami se connecte)
CREATE TABLE IF NOT EXISTS friend_online_notifs (
    user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, target_id)
);

-- Historique des appels
CREATE TABLE IF NOT EXISTS call_history (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    caller_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    callee_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dm_id      UUID REFERENCES dm_channels(id) ON DELETE SET NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at   TIMESTAMPTZ,
    duration_s INT,
    call_type  VARCHAR(10) NOT NULL DEFAULT 'voice',
    status     VARCHAR(10) NOT NULL DEFAULT 'missed'
);

-- Messages épinglés en DM
CREATE TABLE IF NOT EXISTS dm_pins (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dm_channel_id UUID NOT NULL REFERENCES dm_channels(id) ON DELETE CASCADE,
    message_id    UUID NOT NULL REFERENCES dm_messages(id) ON DELETE CASCADE,
    pinned_by     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pinned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (dm_channel_id, message_id)
);

-- Extensions dm_channels : archive, mute, dernière activité
ALTER TABLE dm_channels ADD COLUMN IF NOT EXISTS archived_by_user1    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE dm_channels ADD COLUMN IF NOT EXISTS archived_by_user2    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE dm_channels ADD COLUMN IF NOT EXISTS muted_by_user1_until TIMESTAMPTZ;
ALTER TABLE dm_channels ADD COLUMN IF NOT EXISTS muted_by_user2_until TIMESTAMPTZ;
ALTER TABLE dm_channels ADD COLUMN IF NOT EXISTS last_message_at      TIMESTAMPTZ;
ALTER TABLE dm_channels ADD COLUMN IF NOT EXISTS last_message_preview  VARCHAR(200);

-- Extensions friendships : message de demande
ALTER TABLE friendships ADD COLUMN IF NOT EXISTS message      TEXT;
ALTER TABLE friendships ADD COLUMN IF NOT EXISTS friend_since TIMESTAMPTZ;

-- Index performances
CREATE INDEX IF NOT EXISTS idx_friend_notes_user   ON friend_notes(user_id);
CREATE INDEX IF NOT EXISTS idx_friend_groups_user  ON friend_groups(user_id);
CREATE INDEX IF NOT EXISTS idx_call_history_caller ON call_history(caller_id);
CREATE INDEX IF NOT EXISTS idx_call_history_callee ON call_history(callee_id);
CREATE INDEX IF NOT EXISTS idx_dm_pins_channel     ON dm_pins(dm_channel_id);
