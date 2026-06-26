-- Replies dans les DMs
ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES dm_messages(id) ON DELETE SET NULL;

-- Attachments pour les DMs (réutilise la table attachments existante via dm_message_id)
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS dm_message_id UUID REFERENCES dm_messages(id) ON DELETE CASCADE;
-- Rendre message_id nullable pour que les attachments puissent appartenir soit à messages soit à dm_messages
ALTER TABLE attachments ALTER COLUMN message_id DROP NOT NULL;
