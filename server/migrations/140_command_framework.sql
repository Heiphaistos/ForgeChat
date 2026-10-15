-- Cadre des commandes slash : métadonnées de permission, options typées, rappel HTTP des bots,
-- exceptions par serveur, avertissements de modération et interactions (réponses des bots).

ALTER TABLE bot_commands ADD COLUMN IF NOT EXISTS options JSONB NOT NULL DEFAULT '[]'::JSONB;
-- 'everyone' | nom d'une permission (KICK_MEMBERS…) | 'owner'
ALTER TABLE bot_commands ADD COLUMN IF NOT EXISTS required_permission VARCHAR(32) NOT NULL DEFAULT 'everyone';
ALTER TABLE bot_commands ADD COLUMN IF NOT EXISTS category VARCHAR(32) NOT NULL DEFAULT 'general';
ALTER TABLE bot_commands ADD COLUMN IF NOT EXISTS dangerous BOOLEAN NOT NULL DEFAULT FALSE;

-- URL de rappel HTTPS d'un bot (les commandes lui sont POSTées, signées HMAC-SHA256).
ALTER TABLE bot_tokens ADD COLUMN IF NOT EXISTS callback_url TEXT;

CREATE TABLE IF NOT EXISTS server_command_overrides (
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    command VARCHAR(32) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    -- Rôles qui peuvent l'utiliser en plus de ceux qui ont la permission requise.
    allowed_role_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    -- NULL = permission par défaut de la commande.
    required_permission VARCHAR(32),
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (server_id, command)
);

CREATE TABLE IF NOT EXISTS member_warnings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    moderator_id UUID REFERENCES users(id) ON DELETE SET NULL,
    reason VARCHAR(300) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS member_warnings_user_idx ON member_warnings (server_id, user_id, created_at DESC);

-- Une interaction = une commande de bot en cours ; le bot y répond (au plus 5 fois, 15 min).
CREATE TABLE IF NOT EXISTS command_interactions (
    command VARCHAR(32) NOT NULL DEFAULT '',
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bot_token_id UUID NOT NULL REFERENCES bot_tokens(id) ON DELETE CASCADE,
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    replies INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS command_interactions_created_idx ON command_interactions (created_at);
