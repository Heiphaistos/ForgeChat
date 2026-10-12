-- Synchronisation périodique d'un serveur Discord vers un serveur ForgeChat
-- (handlers/discord_import/sync.rs) : seul le NOUVEAU contenu est importé.

-- Configuration, une par serveur ForgeChat. Le jeton du bot Discord est chiffré au
-- repos (email_crypto::seal_with, info « forgechat discord sync token v1 », AAD = server_id)
-- et n'est jamais renvoyé par l'API.
CREATE TABLE IF NOT EXISTS discord_sync_configs (
    server_id           UUID PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
    guild_id            VARCHAR(21) NOT NULL CHECK (guild_id ~ '^[0-9]{15,21}$'),
    bot_token_enc       TEXT,
    interval_hours      SMALLINT NOT NULL DEFAULT 24 CHECK (interval_hours IN (24, 48)),
    -- Identifiants ou noms de catégories Discord exclues (noms comparés sans casse ni accents).
    excluded_categories TEXT[] NOT NULL DEFAULT ARRAY['actualité']::TEXT[],
    enabled             BOOLEAN NOT NULL DEFAULT FALSE,
    sync_emojis         BOOLEAN NOT NULL DEFAULT TRUE,
    next_sync_at        TIMESTAMPTZ,
    last_sync_at        TIMESTAMPTZ,
    last_status         VARCHAR(8) CHECK (last_status IN ('ok', 'partial', 'error')),
    last_error          TEXT,
    last_imported       INT NOT NULL DEFAULT 0,
    updated_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_discord_sync_due ON discord_sync_configs (next_sync_at) WHERE enabled;

-- Correspondance identifiant Discord -> identifiant ForgeChat (catégories, salons,
-- messages synchronisés, émojis). Une ligne dont la cible a été supprimée côté ForgeChat
-- est conservée : l'élément a été retiré volontairement, il n'est pas recréé.
CREATE TABLE IF NOT EXISTS discord_sync_map (
    server_id    UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    kind         VARCHAR(10) NOT NULL CHECK (kind IN ('category', 'channel', 'message', 'emoji')),
    discord_id   VARCHAR(21) NOT NULL,
    forgechat_id UUID NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (server_id, kind, discord_id)
);

-- Curseur par salon Discord : identifiant du dernier message importé.
CREATE TABLE IF NOT EXISTS discord_sync_cursors (
    server_id          UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    discord_channel_id VARCHAR(21) NOT NULL,
    last_message_id    VARCHAR(21) NOT NULL,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (server_id, discord_channel_id)
);
