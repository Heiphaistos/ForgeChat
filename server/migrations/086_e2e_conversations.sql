-- Chiffrement de bout en bout des MP et groupes (docs/CHIFFREMENT-E2E.md §4.1, §6).
-- Le serveur ne voit que des enveloppes et des messages chiffrés sur les appareils.

-- Époque courante par conversation (conv_kind 'dm' ou 'group'). `rotate_needed` :
-- un membre est parti ou a été exclu, le prochain émetteur doit créer l'époque suivante.
CREATE TABLE IF NOT EXISTS conversation_epochs (
    conv_kind TEXT NOT NULL CHECK (conv_kind IN ('dm', 'group')),
    conv_id UUID NOT NULL,
    current_epoch INT NOT NULL CHECK (current_epoch >= 0),
    rotate_needed BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (conv_kind, conv_id)
);

-- Clé de conversation enveloppée pour un membre : AES-GCM(HKDF(ECDH(émetteur, membre))).
-- `member_fp` : empreinte de la clé publique du membre au moment de l'enveloppe
-- (une enveloppe faite pour une ancienne clé peut être remplacée).
-- `wrapped_by_pub` : clé publique de l'émetteur, nécessaire pour ouvrir l'enveloppe.
CREATE TABLE IF NOT EXISTS conversation_keys (
    conv_kind TEXT NOT NULL CHECK (conv_kind IN ('dm', 'group')),
    conv_id UUID NOT NULL,
    epoch INT NOT NULL CHECK (epoch >= 0),
    member_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    member_fp TEXT NOT NULL,
    wrapped JSONB NOT NULL,            -- {v, iv, ct}
    wrapped_by UUID REFERENCES users(id) ON DELETE SET NULL,
    wrapped_by_pub TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (conv_kind, conv_id, epoch, member_id)
);
CREATE INDEX IF NOT EXISTS conversation_keys_member_idx ON conversation_keys (member_id, conv_kind, conv_id);

-- Messages : `enc` = {v, epoch, iv, ct} (contenu NULL), `client_msg_id` entre dans l'AAD,
-- `purged` = texte en clair d'avant le chiffrement effacé à J+30.
ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS enc JSONB;
ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS client_msg_id UUID;
ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS purged BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE group_dm_messages ADD COLUMN IF NOT EXISTS enc JSONB;
ALTER TABLE group_dm_messages ADD COLUMN IF NOT EXISTS client_msg_id UUID;
ALTER TABLE group_dm_messages ADD COLUMN IF NOT EXISTS purged BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS dm_messages_client_msg_idx
    ON dm_messages (dm_channel_id, client_msg_id) WHERE client_msg_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS group_dm_messages_client_msg_idx
    ON group_dm_messages (dm_id, client_msg_id) WHERE client_msg_id IS NOT NULL;
-- Rechiffrement de l'historique : « mes messages encore en clair ».
CREATE INDEX IF NOT EXISTS dm_messages_legacy_idx ON dm_messages (sender_id)
    WHERE enc IS NULL AND content IS NOT NULL;
CREATE INDEX IF NOT EXISTS group_dm_messages_legacy_idx ON group_dm_messages (sender_id)
    WHERE enc IS NULL AND content IS NOT NULL;

-- Date de déploiement du chiffrement des MP : départ du délai de 30 jours avant la purge
-- du texte en clair antérieur (une seule ligne).
CREATE TABLE IF NOT EXISTS e2e_rollout (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO e2e_rollout DEFAULT VALUES ON CONFLICT DO NOTHING;
