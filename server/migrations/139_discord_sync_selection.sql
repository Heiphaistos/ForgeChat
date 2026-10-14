-- Synchronisation Discord : sélection précise des éléments (catégories, salons, forums) et mode.
-- sync_mode : 'full' = crée les éléments manquants + importe les messages ; 'content' = messages seulement.
-- included_ids / excluded_ids : identifiants Discord cochés / décochés. Un élément absent des deux
-- listes (apparu depuis) suit auto_include_new. Défauts = comportement antérieur (tout, sauf excluded_categories).
ALTER TABLE discord_sync_configs ADD COLUMN IF NOT EXISTS sync_mode TEXT NOT NULL DEFAULT 'full';
ALTER TABLE discord_sync_configs ADD COLUMN IF NOT EXISTS included_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE discord_sync_configs ADD COLUMN IF NOT EXISTS excluded_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE discord_sync_configs ADD COLUMN IF NOT EXISTS auto_include_new BOOLEAN NOT NULL DEFAULT TRUE;
DO $$ BEGIN
    ALTER TABLE discord_sync_configs ADD CONSTRAINT discord_sync_mode_chk CHECK (sync_mode IN ('full', 'content'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
