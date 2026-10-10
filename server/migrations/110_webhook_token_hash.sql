-- Jetons de webhook entrants hachés (SHA-256 hex) : le jeton en clair n'est plus gardé,
-- il n'est montré qu'à la création. Idempotent : seules les lignes encore en clair sont converties.
ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS token_hash TEXT;
ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS token_preview TEXT;
ALTER TABLE webhooks ALTER COLUMN token DROP DEFAULT;
ALTER TABLE webhooks ALTER COLUMN token DROP NOT NULL;
UPDATE webhooks
   SET token_hash = encode(sha256(convert_to(token, 'UTF8')), 'hex'),
       token_preview = '••••' || right(token, 4),
       token = NULL
 WHERE token IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS webhooks_token_hash_idx ON webhooks (token_hash);
