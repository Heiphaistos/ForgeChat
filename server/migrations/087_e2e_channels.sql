-- Chiffrement de bout en bout des salons de serveur (docs/CHIFFREMENT-E2E.md §10).
-- Même mécanisme que les MP (086) avec un `conv_kind` « channel » : la conversation
-- est le salon, les fils et publications de forum utilisent la clé de leur salon.

ALTER TABLE conversation_epochs DROP CONSTRAINT IF EXISTS conversation_epochs_conv_kind_check;
ALTER TABLE conversation_epochs ADD CONSTRAINT conversation_epochs_conv_kind_check
    CHECK (conv_kind IN ('dm', 'group', 'channel'));
ALTER TABLE conversation_keys DROP CONSTRAINT IF EXISTS conversation_keys_conv_kind_check;
ALTER TABLE conversation_keys ADD CONSTRAINT conversation_keys_conv_kind_check
    CHECK (conv_kind IN ('dm', 'group', 'channel'));
-- Détenteurs de l'époque courante d'un salon (contrôle de rotation à chaque envoi).
CREATE INDEX IF NOT EXISTS conversation_keys_epoch_idx ON conversation_keys (conv_kind, conv_id, epoch);

-- Messages de salon : `enc` = {v, epoch, iv, ct}, `content` NULL ; `client_msg_id` entre dans l'AAD.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS enc JSONB;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS client_msg_id UUID;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS purged BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS messages_client_msg_idx
    ON messages (channel_id, client_msg_id) WHERE client_msg_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_legacy_idx ON messages (user_id)
    WHERE enc IS NULL AND content IS NOT NULL;

-- Fils : titre chiffré (`title_enc`, `title` vide) ; `client_id` lie titre et messages du fil (AAD).
ALTER TABLE threads ADD COLUMN IF NOT EXISTS client_id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE threads ADD COLUMN IF NOT EXISTS title_enc JSONB;
ALTER TABLE thread_messages ALTER COLUMN content DROP NOT NULL;
ALTER TABLE thread_messages ADD COLUMN IF NOT EXISTS enc JSONB;
ALTER TABLE thread_messages ADD COLUMN IF NOT EXISTS client_msg_id UUID;
ALTER TABLE thread_messages ADD COLUMN IF NOT EXISTS purged BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS thread_messages_legacy_idx ON thread_messages (user_id)
    WHERE enc IS NULL AND content IS NOT NULL;

-- Forums et salons médias : titre + contenu dans un seul `enc` ({t, title}), `title` vide.
ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS enc JSONB;
ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS client_msg_id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS purged BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE forum_replies ALTER COLUMN content DROP NOT NULL;
ALTER TABLE forum_replies ADD COLUMN IF NOT EXISTS enc JSONB;
ALTER TABLE forum_replies ADD COLUMN IF NOT EXISTS client_msg_id UUID;
ALTER TABLE forum_replies ADD COLUMN IF NOT EXISTS purged BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS forum_posts_legacy_idx ON forum_posts (creator_id)
    WHERE enc IS NULL AND (content IS NOT NULL OR title <> '');
CREATE INDEX IF NOT EXISTS forum_replies_legacy_idx ON forum_replies (user_id)
    WHERE enc IS NULL AND content IS NOT NULL;

-- Sondages : question et options chiffrées ({t, o}) ; les votes restent en clair.
ALTER TABLE polls ADD COLUMN IF NOT EXISTS enc JSONB;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS client_msg_id UUID;

-- Messages programmés : chiffrés à la création, recopiés tels quels à l'envoi.
ALTER TABLE scheduled_messages ALTER COLUMN content DROP NOT NULL;
ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS enc JSONB;
ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS client_msg_id UUID;

-- Signalement d'un message chiffré : texte déchiffré fourni par le signaleur.
ALTER TABLE message_reports ADD COLUMN IF NOT EXISTS content TEXT;

-- Départ du délai de 30 jours avant la purge du clair antérieur des salons.
ALTER TABLE e2e_rollout ADD COLUMN IF NOT EXISTS channels_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Clé de récupération d'un serveur (paire ECDH P-256 générée par l'appli du propriétaire).
-- `recovery` : clé privée chiffrée par le code de récupération du serveur ({v,salt,iv,ct}) ;
-- `owner_wrapped` : la même pour la clé de compte du propriétaire `owner_id` ({v,iv,ct}).
CREATE TABLE IF NOT EXISTS server_keys (
    server_id UUID PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
    public_key TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    recovery JSONB NOT NULL,
    owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
    owner_wrapped JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Clé d'époque d'un salon enveloppée pour la clé de serveur (membre virtuel `server:<id>`).
CREATE TABLE IF NOT EXISTS server_epoch_keys (
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    epoch INT NOT NULL CHECK (epoch >= 0),
    server_fp TEXT NOT NULL,
    wrapped JSONB NOT NULL,
    wrapped_by UUID REFERENCES users(id) ON DELETE SET NULL,
    wrapped_by_pub TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (channel_id, epoch)
);
