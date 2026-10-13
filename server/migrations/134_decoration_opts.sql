-- Personnalisation du profil, suite (models/profile_style.rs) :
--  * réglages de la décoration d'avatar (animation, sens et vitesse de rotation, pulsation,
--    luminosité, saturation, halo, opacité, teinte, taille, couleur de teinte) ;
--  * intensité de l'effet de profil (nombre de particules, en %).
-- Les réglages sont du JSON validé par liste blanche côté serveur (nombres bornés, sens connu,
-- couleur 0xRRGGBB) : aucun CSS ni texte libre. Valeurs par défaut non stockées (NULL).
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_decoration_opts JSONB;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_effect_intensity SMALLINT;

-- Garde-fous en base, en plus de la validation applicative : un objet JSON de taille bornée
-- (même borne que profile_style::DECORATION_OPTS_MAX_BYTES) et une intensité de 25 à 200 %.
-- Colonnes neuves : aucune ligne existante à rattraper, contraintes validées directement.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_decoration_opts_shape') THEN
        ALTER TABLE users ADD CONSTRAINT users_decoration_opts_shape
            CHECK (avatar_decoration_opts IS NULL
                   OR (jsonb_typeof(avatar_decoration_opts) = 'object'
                       AND octet_length(avatar_decoration_opts::text) <= 512));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_effect_intensity_range') THEN
        ALTER TABLE users ADD CONSTRAINT users_effect_intensity_range
            CHECK (profile_effect_intensity IS NULL OR profile_effect_intensity BETWEEN 25 AND 200);
    END IF;
END $$;
