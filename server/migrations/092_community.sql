-- Lot « Serveurs et communauté » : modèles, événements, niveaux, starboard, tickets,
-- bienvenue, AutoMod avancé, statistiques, annuaire. Aucun contenu de conversation ici :
-- seulement des réglages et des métadonnées (le serveur ne lit jamais le texte chiffré).

-- Modèles : catégorie réservée au staff (ADMINISTRATOR / propriétaire).
ALTER TABLE categories ADD COLUMN IF NOT EXISTS staff_only BOOLEAN NOT NULL DEFAULT FALSE;

-- Événements : récurrence et rappel (minutes avant le début, NULL = aucun).
ALTER TABLE server_events ADD COLUMN IF NOT EXISTS recurrence VARCHAR(10) NOT NULL DEFAULT 'none'
    CHECK (recurrence IN ('none', 'daily', 'weekly', 'monthly'));
ALTER TABLE server_events ADD COLUMN IF NOT EXISTS reminder_minutes INTEGER
    CHECK (reminder_minutes IS NULL OR reminder_minutes BETWEEN 1 AND 10080);
-- Début de l'occurrence déjà rappelée (une occurrence n'est rappelée qu'une fois).
ALTER TABLE server_events ADD COLUMN IF NOT EXISTS reminded_for TIMESTAMPTZ;

-- Niveaux et XP (sans bot) : seulement le fait d'écrire ou de parler, jamais le contenu.
CREATE TABLE IF NOT EXISTS level_settings (
    server_id UUID PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    xp_per_message INTEGER NOT NULL DEFAULT 15 CHECK (xp_per_message BETWEEN 0 AND 1000),
    xp_per_voice_minute INTEGER NOT NULL DEFAULT 10 CHECK (xp_per_voice_minute BETWEEN 0 AND 1000),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS member_levels (
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    xp BIGINT NOT NULL DEFAULT 0,
    level INTEGER NOT NULL DEFAULT 0,
    messages INTEGER NOT NULL DEFAULT 0,
    voice_minutes INTEGER NOT NULL DEFAULT 0,
    last_message_xp_at TIMESTAMPTZ,
    PRIMARY KEY (server_id, user_id)
);
CREATE INDEX IF NOT EXISTS member_levels_rank_idx ON member_levels (server_id, xp DESC);
CREATE TABLE IF NOT EXISTS level_roles (
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 1000),
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (server_id, level, role_id)
);

-- Métadonnées d'un message système (bienvenue : numéro de membre ; starboard : référence
-- au message mis en avant, qui reste chiffré dans son salon d'origine).
ALTER TABLE messages ADD COLUMN IF NOT EXISTS system_meta JSONB;

-- Starboard.
CREATE TABLE IF NOT EXISTS starboard_settings (
    server_id UUID PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    channel_id UUID REFERENCES channels(id) ON DELETE SET NULL,
    emoji VARCHAR(64) NOT NULL DEFAULT '⭐',
    threshold INTEGER NOT NULL DEFAULT 3 CHECK (threshold BETWEEN 1 AND 100)
);
CREATE TABLE IF NOT EXISTS starboard_entries (
    message_id UUID PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    starboard_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tickets : salon privé par ticket, rôles d'équipe configurables.
CREATE TABLE IF NOT EXISTS ticket_settings (
    server_id UUID PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    staff_role_ids UUID[] NOT NULL DEFAULT '{}'
);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES channels(id) ON DELETE SET NULL;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS number INTEGER;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS tickets_server_number_idx ON tickets (server_id, number) WHERE number IS NOT NULL;

-- Messages de bienvenue (carte générée par l'appli).
CREATE TABLE IF NOT EXISTS welcome_settings (
    server_id UUID PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    channel_id UUID REFERENCES channels(id) ON DELETE SET NULL,
    text VARCHAR(500) NOT NULL DEFAULT 'Bienvenue {user} sur {server} ! Tu es le membre n°{count}.'
);

-- AutoMod avancé (métadonnées seulement côté serveur) et verrouillage.
ALTER TABLE automod_rules
    ADD COLUMN IF NOT EXISTS rate_limit_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS rate_limit_seconds INTEGER NOT NULL DEFAULT 10,
    ADD COLUMN IF NOT EXISTS raid_join_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS raid_join_seconds INTEGER NOT NULL DEFAULT 60,
    ADD COLUMN IF NOT EXISTS block_dangerous_links BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS blocked_domains TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS lockdown BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS lockdown_reason VARCHAR(10);

-- Statistiques : présence vocale par jour (minutes cumulées, pic de présents).
CREATE TABLE IF NOT EXISTS server_voice_daily (
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    day DATE NOT NULL,
    minutes INTEGER NOT NULL DEFAULT 0,
    peak INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (server_id, day)
);
CREATE INDEX IF NOT EXISTS audit_log_server_user_idx ON audit_log (server_id, user_id, created_at DESC);

-- Annuaire des serveurs publics : étiquettes.
ALTER TABLE servers ADD COLUMN IF NOT EXISTS discovery_tags TEXT[] NOT NULL DEFAULT '{}';
