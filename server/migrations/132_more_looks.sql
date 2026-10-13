-- ─── Migration 132 : plus de personnalisation (Apparence) ────────────────────
-- Forme d'avatar « squircle » (carré aux coins continus) en plus de rond, arrondi et carré.
-- Les styles de catégorie et la disposition restent dans user_theme_studio (JSON validé par
-- chaque client) : rien d'autre à changer côté base.
ALTER TABLE user_settings DROP CONSTRAINT IF EXISTS user_settings_avatar_shape_check;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_settings_avatar_shape_ok') THEN
        ALTER TABLE user_settings ADD CONSTRAINT user_settings_avatar_shape_ok
            CHECK (avatar_shape IN ('round', 'square', 'rounded', 'squircle'));
    END IF;
END $$;
