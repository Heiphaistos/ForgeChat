-- Migration 017 : stickers custom par serveur
CREATE TABLE IF NOT EXISTS server_stickers (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id   UUID        NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name        VARCHAR(50) NOT NULL,
    description VARCHAR(200),
    url         VARCHAR(500) NOT NULL,
    uploaded_by UUID        REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_server_stickers_server ON server_stickers(server_id);
