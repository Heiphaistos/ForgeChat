-- Dérivation du mot de passe sur l'appareil (audit 2026-10-12, M3) : `pbkdf2` (PBKDF2-SHA256 600 000)
-- ou `argon2id` (m = 19 Mio, t = 2, p = 1). Le serveur ne fait que la mémoriser et la rendre au prelogin.
ALTER TABLE users ADD COLUMN IF NOT EXISTS kdf TEXT NOT NULL DEFAULT 'pbkdf2';
ALTER TABLE pending_registrations ADD COLUMN IF NOT EXISTS kdf TEXT NOT NULL DEFAULT 'pbkdf2';
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_kdf_check CHECK (kdf IN ('pbkdf2', 'argon2id'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE pending_registrations ADD CONSTRAINT pending_kdf_check CHECK (kdf IN ('pbkdf2', 'argon2id'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
