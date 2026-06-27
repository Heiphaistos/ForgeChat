CREATE TABLE dm_reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dm_message_id UUID NOT NULL REFERENCES dm_messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji VARCHAR(64) NOT NULL,
    UNIQUE(dm_message_id, user_id, emoji)
);

CREATE INDEX dm_reactions_message_id ON dm_reactions(dm_message_id);
