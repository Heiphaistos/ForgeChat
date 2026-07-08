-- Messages épinglés dans les groupes DM — parité avec les canaux
CREATE TABLE IF NOT EXISTS group_dm_pins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dm_id UUID NOT NULL REFERENCES group_dm_channels(id) ON DELETE CASCADE,
    message_id UUID NOT NULL REFERENCES group_dm_messages(id) ON DELETE CASCADE,
    pinned_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(message_id)
);

CREATE INDEX IF NOT EXISTS idx_group_dm_pins_dm ON group_dm_pins(dm_id);
