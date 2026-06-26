-- Migration 019: DM user settings (muted, archived per user)

CREATE TABLE IF NOT EXISTS dm_user_settings (
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dm_channel_id UUID NOT NULL REFERENCES dm_channels(id) ON DELETE CASCADE,
    muted         BOOLEAN NOT NULL DEFAULT FALSE,
    archived      BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, dm_channel_id)
);
