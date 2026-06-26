-- Contrainte UNIQUE pour les overrides de permissions de canal
-- Permet l'upsert ON CONFLICT (channel_id, target_id)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'channel_permissions_channel_target_unique'
    ) THEN
        ALTER TABLE channel_permissions
            ADD CONSTRAINT channel_permissions_channel_target_unique
            UNIQUE (channel_id, target_id);
    END IF;
END$$;
