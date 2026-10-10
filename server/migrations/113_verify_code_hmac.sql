-- Audit 2026-10-10, phase 4 : le code de vérification d'inscription n'est plus gardé en clair.
-- `code` = HMAC-SHA256 hexadécimal (clé HKDF de EMAIL_ENC_KEY, info "forgechat verify code v1",
-- message "<email_hmac>|<code>") ; `attempts` = mauvais codes, la demande est supprimée au 5e.
-- Les demandes en cours (15 min de vie) sont purgées : il suffit de se réinscrire.
DELETE FROM pending_registrations;
ALTER TABLE pending_registrations ALTER COLUMN code TYPE TEXT;
ALTER TABLE pending_registrations ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0;
