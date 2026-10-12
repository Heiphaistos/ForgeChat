-- Clé de récupération d'un serveur signée par la clé de compte de son propriétaire (audit 2026-10-12, H2).
-- signature : ECDSA P-256 / SHA-256 (r ‖ s, 64 octets, base64url) de
-- « forgechat server-key sig v1|<server_id>|<signed_by>|<public_key> », par la clé de compte de `signed_by`.
ALTER TABLE server_keys ADD COLUMN IF NOT EXISTS signature TEXT;
ALTER TABLE server_keys ADD COLUMN IF NOT EXISTS signed_by UUID REFERENCES users(id) ON DELETE SET NULL;
