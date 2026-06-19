-- Migration 009 : Slash commands bots + Message forwarding

-- Table des slash commands enregistrées par les bots
CREATE TABLE IF NOT EXISTS bot_commands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bot_id UUID NOT NULL REFERENCES bot_tokens(id) ON DELETE CASCADE,
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name VARCHAR(32) NOT NULL,
    description VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(bot_id, server_id, name)
);

-- Forward (transfert de messages)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS forward_from_id UUID REFERENCES messages(id);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS forward_from_username VARCHAR(50);

-- ============================================================
-- TÂCHE 1 : Server Templates
-- ============================================================
CREATE TABLE IF NOT EXISTS server_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    creator_id UUID REFERENCES users(id) ON DELETE SET NULL,
    server_id UUID REFERENCES servers(id) ON DELETE SET NULL,
    is_public BOOLEAN NOT NULL DEFAULT FALSE,
    usage_count INTEGER NOT NULL DEFAULT 0,
    template_data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS server_templates_public ON server_templates(is_public) WHERE is_public = TRUE;
CREATE INDEX IF NOT EXISTS server_templates_creator ON server_templates(creator_id);

-- ============================================================
-- TÂCHE 2 : Verification Gate
-- ============================================================
ALTER TABLE servers ADD COLUMN IF NOT EXISTS verification_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS verification_rules TEXT;
ALTER TABLE server_members ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- ============================================================
-- TÂCHE 3 : Canaux vocaux temporaires (Auto-create)
-- ============================================================
ALTER TABLE channels ADD COLUMN IF NOT EXISTS is_auto_create BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS auto_create_name VARCHAR(100);
ALTER TABLE channels ADD COLUMN IF NOT EXISTS is_temporary BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS created_by_auto UUID REFERENCES users(id) ON DELETE SET NULL;
