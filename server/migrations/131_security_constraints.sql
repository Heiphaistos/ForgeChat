-- Garde-fous en base (audit de sécurité du 2026-10-12), en plus de la validation
-- applicative : configuration de synchronisation Discord, et validation des quatre
-- contraintes NOT VALID de la migration 129.

-- ─── discord_sync_configs (migration 130, handlers/discord_import/sync.rs) ──────

-- Règles d'exclusion : 100 caractères au plus chacune (sync_rules::validate_excluded).
-- IMMUTABLE : utilisable dans un CHECK (pas de sous-requête permise directement).
CREATE OR REPLACE FUNCTION discord_sync_rules_ok(rules TEXT[]) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT COALESCE(bool_and(r IS NOT NULL AND char_length(r) <= 100), TRUE) FROM unnest(rules) AS r
$$;

-- Lignes existantes ramenées dans les bornes avant les contraintes.
-- Jeton dans un autre format que `v1:` (email_crypto::seal_with) : illisible de toute
-- façon, effacé, synchronisation désactivée.
UPDATE discord_sync_configs SET bot_token_enc = NULL, enabled = FALSE
 WHERE bot_token_enc IS NOT NULL AND bot_token_enc NOT LIKE 'v1:%';
-- 250 caractères : au plus 1000 octets en UTF-8.
UPDATE discord_sync_configs SET last_error = left(last_error, 250)
 WHERE octet_length(last_error) > 1000;
UPDATE discord_sync_configs
   SET excluded_categories = ARRAY(
        SELECT left(r, 100) FROM unnest(excluded_categories) WITH ORDINALITY AS u(r, i)
         WHERE r IS NOT NULL AND i <= 50 ORDER BY i)
 WHERE cardinality(excluded_categories) > 50 OR NOT discord_sync_rules_ok(excluded_categories);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discord_sync_token_sealed') THEN
        ALTER TABLE discord_sync_configs ADD CONSTRAINT discord_sync_token_sealed
            CHECK (bot_token_enc IS NULL OR (bot_token_enc LIKE 'v1:%' AND octet_length(bot_token_enc) <= 1024));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discord_sync_last_error_size') THEN
        ALTER TABLE discord_sync_configs ADD CONSTRAINT discord_sync_last_error_size
            CHECK (last_error IS NULL OR octet_length(last_error) <= 1000);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discord_sync_excluded_bounds') THEN
        ALTER TABLE discord_sync_configs ADD CONSTRAINT discord_sync_excluded_bounds
            CHECK (cardinality(excluded_categories) <= 50 AND discord_sync_rules_ok(excluded_categories));
    END IF;
END $$;

-- ─── Migration 129 : contraintes NOT VALID validées ─────────────────────────────

-- Lignes antérieures hors bornes : couleur ramenée à 0xRRGGBB, styles trop gros effacés
-- (retour au style par défaut ; rien d'autre n'en dépend). Une seule mise à jour par
-- table : toute ligne réécrite est vérifiée contre TOUTES ses contraintes, même NOT VALID.
UPDATE server_tags
   SET color = CASE WHEN color BETWEEN 0 AND 16777215 THEN color ELSE color & 16777215 END,
       style = CASE WHEN octet_length(style::text) > 256 THEN NULL ELSE style END
 WHERE color NOT BETWEEN 0 AND 16777215 OR octet_length(style::text) > 256;
UPDATE server_members
   SET server_avatar_ring = CASE WHEN octet_length(server_avatar_ring::text) > 256 THEN NULL ELSE server_avatar_ring END,
       server_name_style = CASE WHEN octet_length(server_name_style::text) > 1024 THEN NULL ELSE server_name_style END
 WHERE octet_length(server_avatar_ring::text) > 256 OR octet_length(server_name_style::text) > 1024;

ALTER TABLE server_members VALIDATE CONSTRAINT server_members_ring_size;
ALTER TABLE server_members VALIDATE CONSTRAINT server_members_name_style_size;
ALTER TABLE server_tags VALIDATE CONSTRAINT server_tags_style_size;
ALTER TABLE server_tags VALIDATE CONSTRAINT server_tags_color_rgb;
