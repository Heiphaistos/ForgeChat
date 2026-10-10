-- Audit 2026-10-10, phase 4 : secret du webhook GitHub d'un salon chiffré au repos.
-- `github_webhook_token_enc` = `v1:` + base64url(iv ‖ AES-256-GCM), clé HKDF(EMAIL_ENC_KEY,
-- "forgechat github token v1"), AAD = "forgechat github token v1|<channel_id>" (le serveur doit le
-- relire : c'est la clé HMAC de X-Hub-Signature-256). L'ancienne colonne en clair est chiffrée puis
-- vidée au démarrage (handlers::webhooks::migrate_github_tokens).
ALTER TABLE channels ADD COLUMN IF NOT EXISTS github_webhook_token_enc TEXT;
