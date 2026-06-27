ALTER TABLE attachments ADD COLUMN IF NOT EXISTS group_dm_message_id UUID REFERENCES group_dm_messages(id) ON DELETE CASCADE;
