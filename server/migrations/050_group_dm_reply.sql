-- Réponses (reply) dans les groupes DM — parité avec les canaux et DMs 1:1
ALTER TABLE group_dm_messages
    ADD COLUMN IF NOT EXISTS reply_to UUID REFERENCES group_dm_messages(id) ON DELETE SET NULL;
