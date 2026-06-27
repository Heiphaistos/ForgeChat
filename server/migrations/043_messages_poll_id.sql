ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS poll_id UUID REFERENCES polls(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_poll_id ON messages(poll_id) WHERE poll_id IS NOT NULL;
