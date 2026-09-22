-- Import d'un serveur Discord depuis un export ArchiveForge (ZIP).

-- Suivi des imports en arrière-plan (un seul actif par utilisateur).
CREATE TABLE server_imports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(16) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    progress INT NOT NULL DEFAULT 0,
    label TEXT,
    server_id UUID REFERENCES servers(id) ON DELETE SET NULL,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX server_imports_one_active_per_user
    ON server_imports(user_id) WHERE status IN ('pending', 'running');

-- Les messages importés sont postés par l'importateur sous le nom de l'auteur
-- Discord (mécanisme des webhooks, 054). Les fils et forums n'avaient pas ce
-- mécanisme ; l'avatar d'origine est ajouté partout. Chaîne vide = pas d'avatar
-- (ne pas retomber sur celui de l'importateur).
ALTER TABLE messages ADD COLUMN webhook_avatar_url TEXT;
ALTER TABLE threads ADD COLUMN webhook_display_name TEXT, ADD COLUMN webhook_avatar_url TEXT;
ALTER TABLE thread_messages ADD COLUMN webhook_display_name TEXT, ADD COLUMN webhook_avatar_url TEXT;
ALTER TABLE forum_posts ADD COLUMN webhook_display_name TEXT, ADD COLUMN webhook_avatar_url TEXT;
ALTER TABLE forum_replies ADD COLUMN webhook_display_name TEXT, ADD COLUMN webhook_avatar_url TEXT;
