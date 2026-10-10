-- Audit 2026-10-10, phase 4 : date d'anniversaire chiffrée au repos.
-- `birthday_enc` = `v1:` + base64url(iv ‖ AES-256-GCM) de "AAAA-MM-JJ" (2000 sans année), clé
-- HKDF(EMAIL_ENC_KEY, "forgechat birthday v1"), AAD "forgechat birthday v1|<user_id>".
-- `birthday` (en clair) est chiffrée puis vidée au démarrage (handlers::birthdays::migrate_at_rest).
ALTER TABLE users ADD COLUMN IF NOT EXISTS birthday_enc TEXT;
