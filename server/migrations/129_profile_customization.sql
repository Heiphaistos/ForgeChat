-- Personnalisation du profil, suite (models/profile_style.rs) :
--  * profil de serveur : anneau autour de l'avatar et style du pseudo propres au serveur ;
--  * marques de clan : style (seconde couleur, police, fond, icône).
-- Tout est du JSON validé par liste blanche côté serveur (couleurs 0xRRGGBB, identifiants
-- connus) : aucun CSS ni texte libre n'y est jamais stocké. Les catalogues de décorations
-- d'avatar et d'effets de profil restent en code (models/user.rs), sans migration.
ALTER TABLE server_members ADD COLUMN IF NOT EXISTS server_avatar_ring JSONB;
ALTER TABLE server_members ADD COLUMN IF NOT EXISTS server_name_style JSONB;
ALTER TABLE server_tags ADD COLUMN IF NOT EXISTS style JSONB;

-- Garde-fous en base, en plus de la validation applicative : taille bornée et couleur
-- de tag 0xRRGGBB (avant, n'importe quel entier était accepté). NOT VALID : les lignes
-- existantes ne bloquent pas la migration, les nouvelles sont vérifiées.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'server_members_ring_size') THEN
        ALTER TABLE server_members ADD CONSTRAINT server_members_ring_size
            CHECK (server_avatar_ring IS NULL OR octet_length(server_avatar_ring::text) <= 256) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'server_members_name_style_size') THEN
        ALTER TABLE server_members ADD CONSTRAINT server_members_name_style_size
            CHECK (server_name_style IS NULL OR octet_length(server_name_style::text) <= 1024) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'server_tags_style_size') THEN
        ALTER TABLE server_tags ADD CONSTRAINT server_tags_style_size
            CHECK (style IS NULL OR octet_length(style::text) <= 256) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'server_tags_color_rgb') THEN
        ALTER TABLE server_tags ADD CONSTRAINT server_tags_color_rgb
            CHECK (color BETWEEN 0 AND 16777215) NOT VALID;
    END IF;
END $$;
