ALTER TABLE group_dm_messages
    ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
