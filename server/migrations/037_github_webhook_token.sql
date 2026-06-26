-- Jeton secret pour authentifier les webhooks GitHub entrants
ALTER TABLE channels ADD COLUMN IF NOT EXISTS github_webhook_token TEXT DEFAULT NULL;
