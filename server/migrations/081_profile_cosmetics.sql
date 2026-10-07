-- Personnalisation du profil (gratuite) : décoration d'avatar, thème de la
-- fiche (couleurs principale/accent en 0xRRGGBB) et effet animé à l'ouverture.
-- Décoration et effet : identifiants validés par liste blanche côté serveur
-- (models/user.rs), pas en base, pour pouvoir enrichir le catalogue sans migration.
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_decoration VARCHAR(32);
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_color_primary INT
    CHECK (profile_color_primary BETWEEN 0 AND 16777215);
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_color_accent INT
    CHECK (profile_color_accent BETWEEN 0 AND 16777215);
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_effect VARCHAR(32);
