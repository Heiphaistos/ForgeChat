-- Adresses e-mail chiffrées au repos (src/email_crypto.rs) : empreinte HMAC pour les recherches
-- et l'unicité, chiffré AES-256-GCM pour l'envoi. Le serveur remplit ces colonnes au démarrage
-- puis efface `email` (laissée NULL ; à supprimer plus tard).
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_hmac TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_enc TEXT;
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_hmac_idx ON users (email_hmac);

ALTER TABLE pending_registrations ADD COLUMN IF NOT EXISTS email_hmac TEXT;
ALTER TABLE pending_registrations ALTER COLUMN email DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pending_registrations_email_hmac_idx ON pending_registrations (email_hmac);
