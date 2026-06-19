-- ForgeChat v2.4.0–v2.5.0 — Channel extras, welcome, rich presence, edit history, scheduled

-- Canaux vocaux protégés
ALTER TABLE channels ADD COLUMN IF NOT EXISTS voice_password_hash TEXT;

-- Welcome message serveur
ALTER TABLE servers ADD COLUMN IF NOT EXISTS welcome_message TEXT;

-- Bannière serveur
ALTER TABLE servers ADD COLUMN IF NOT EXISTS banner_url TEXT;

-- Bannière + last_seen utilisateur
ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Rich Presence / Activité
ALTER TABLE users ADD COLUMN IF NOT EXISTS activity_type VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS activity_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS activity_detail VARCHAR(100);

-- Historique des éditions de messages
CREATE TABLE IF NOT EXISTS message_edits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    edited_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS message_edits_message_id ON message_edits(message_id);

-- Messages programmés
CREATE TABLE IF NOT EXISTS scheduled_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    send_at TIMESTAMPTZ NOT NULL,
    sent BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS scheduled_messages_pending ON scheduled_messages(send_at) WHERE sent = FALSE;
