-- Menus contextuels des conversations privées (comme Discord) : sourdine temporaire,
-- conversation épinglée en haut de la liste, conversation fermée (masquée jusqu'au
-- prochain message). Aucun contenu : seulement des réglages par utilisateur.
ALTER TABLE dm_user_settings
    ADD COLUMN IF NOT EXISTS muted_until TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

-- Les groupes privés (group_dm_channels) partagent ces réglages : la clé étrangère vers
-- dm_channels refusait toute sourdine ou archive d'un groupe. L'appartenance est vérifiée
-- par patch_dm_settings.
ALTER TABLE dm_user_settings DROP CONSTRAINT IF EXISTS dm_user_settings_dm_channel_id_fkey;
