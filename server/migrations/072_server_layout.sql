-- Dossiers et ordre des serveurs, synchronisés entre appareils (avant : localStorage du navigateur).
CREATE TABLE IF NOT EXISTS user_server_layout (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    layout JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
