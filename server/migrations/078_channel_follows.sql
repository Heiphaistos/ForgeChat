-- Suivi des salons d'annonces (crosspost, comme Discord) : un message publié dans
-- `source_channel_id` est recopié dans chaque `target_channel_id` qui le suit.
CREATE TABLE IF NOT EXISTS channel_follows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    target_channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source_channel_id, target_channel_id)
);
CREATE INDEX IF NOT EXISTS channel_follows_target ON channel_follows(target_channel_id);

-- Un message d'annonce ne se publie qu'une fois.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS crossposted_at TIMESTAMPTZ;
