-- Clé de compte du chiffrement de bout en bout (docs/CHIFFREMENT-E2E.md §3).
-- Le serveur ne stocke que la clé publique et la clé privée CHIFFRÉE sur
-- l'appareil (par le mot de passe : `wrapped`, par le code de récupération :
-- `backup`). Il ne peut rien en tirer : ni la clé privée ni le code ne lui
-- parviennent en clair.
CREATE TABLE IF NOT EXISTS user_keys (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    public_key TEXT NOT NULL,          -- point P-256 non compressé, base64url
    fingerprint TEXT NOT NULL,         -- SHA-256(public_key brute), base64url, calculée par le serveur
    wrapped JSONB NOT NULL,            -- {v,salt,iv,ct}
    backup JSONB,                      -- {v,salt,iv,ct}, NULL sans code de récupération
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    backup_at TIMESTAMPTZ
);

-- Anciennes clés publiques (réinitialisation) : les 20 dernières par compte,
-- pour vérifier d'anciennes signatures et afficher « la clé de X a changé ».
CREATE TABLE IF NOT EXISTS user_keys_old (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    retired_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS user_keys_old_user_idx ON user_keys_old (user_id, retired_at DESC);
