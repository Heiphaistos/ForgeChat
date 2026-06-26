CREATE TABLE IF NOT EXISTS group_dm_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL DEFAULT 'Groupe',
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_dm_members (
    dm_id UUID NOT NULL REFERENCES group_dm_channels(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (dm_id, user_id)
);

CREATE TABLE IF NOT EXISTS group_dm_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dm_id UUID NOT NULL REFERENCES group_dm_channels(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gdm_messages ON group_dm_messages(dm_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gdm_members ON group_dm_members(user_id);
