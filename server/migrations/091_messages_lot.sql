-- Lot « Messages et discussion » (2026-10-07).

-- Messages éphémères par conversation : NULL = désactivé, 0 = après lecture (MP et groupes),
-- sinon durée en secondes (1 h, 24 h, 7 j). Le serveur ne voit que du chiffré : à l'échéance
-- il supprime la ligne et les fichiers joints.
ALTER TABLE channels ADD COLUMN IF NOT EXISTS disappear_seconds INT;
ALTER TABLE dm_channels ADD COLUMN IF NOT EXISTS disappear_seconds INT;
ALTER TABLE group_dm_channels ADD COLUMN IF NOT EXISTS disappear_seconds INT;

ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS expire_on_read BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE group_dm_messages ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE group_dm_messages ADD COLUMN IF NOT EXISTS expire_on_read BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS dm_messages_expires_idx ON dm_messages (expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS dm_messages_on_read_idx ON dm_messages (dm_channel_id) WHERE expire_on_read AND expires_at IS NULL;
CREATE INDEX IF NOT EXISTS group_dm_messages_expires_idx ON group_dm_messages (expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS group_dm_messages_on_read_idx ON group_dm_messages (dm_id) WHERE expire_on_read AND expires_at IS NULL;

-- Fils automatiques : chaque message du salon ouvre son fil (comme Slack).
ALTER TABLE channels ADD COLUMN IF NOT EXISTS auto_threads BOOLEAN NOT NULL DEFAULT FALSE;

-- Brouillons synchronisés entre appareils, chiffrés par la clé de compte de leur auteur :
-- le serveur ne range qu'un blob opaque {v, iv, ct} par conversation.
CREATE TABLE IF NOT EXISTS message_drafts (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conv_id UUID NOT NULL,
    blob JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, conv_id)
);
