-- Migration 011: E2E encryption — public keys + encrypted DM messages

-- ─── Clés publiques E2E (ECDH P-256) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_pubkeys (
    user_id  UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    pub_key  TEXT NOT NULL,  -- JWK JSON du public key ECDH P-256
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Messages DM chiffrés E2E ─────────────────────────────────────────────────
-- Stocke le ciphertext AES-GCM uniquement — le serveur ne peut pas déchiffrer
CREATE TABLE IF NOT EXISTS dm_e2e_messages (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dm_channel_id UUID NOT NULL REFERENCES dm_channels(id) ON DELETE CASCADE,
    sender_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- base64url(iv || ciphertext) — le IV de 12 octets est préfixé au ciphertext
    ciphertext    TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dm_e2e_messages_channel ON dm_e2e_messages(dm_channel_id, created_at DESC);
