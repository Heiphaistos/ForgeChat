CREATE TABLE IF NOT EXISTS notification_overrides_channel (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    level TEXT NOT NULL DEFAULT 'inherit', -- 'all' | 'mentions' | 'nothing' | 'inherit'
    muted BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE(user_id, channel_id)
);

CREATE INDEX IF NOT EXISTS notif_override_channel_user ON notification_overrides_channel(user_id);
