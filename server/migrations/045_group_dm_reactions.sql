-- Réactions sur les messages de GroupDM
CREATE TABLE IF NOT EXISTS group_dm_reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_dm_message_id UUID NOT NULL REFERENCES group_dm_messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(group_dm_message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_group_dm_reactions_msg ON group_dm_reactions(group_dm_message_id);
