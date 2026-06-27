-- Extend automod_rules with the fields expected by the client
ALTER TABLE automod_rules
    ADD COLUMN IF NOT EXISTS max_mentions INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS max_links INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS anti_spam BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS anti_caps BOOLEAN NOT NULL DEFAULT FALSE;
