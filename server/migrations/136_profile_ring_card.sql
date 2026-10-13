-- Personnalisation du profil, suite :
--  * anneau d'avatar global du compte (models/avatar_ring.rs) ; l'anneau d'un profil de
--    serveur (server_members.server_avatar_ring) reste prioritaire quand il existe ;
--  * mise en page de la carte de profil (models/profile_card.rs).
-- JSON validé par liste blanche côté serveur (couleurs 0xRRGGBB, nombres bornés,
-- identifiants connus) : aucun CSS ni texte libre. Valeurs par défaut non stockées (NULL).
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_ring JSONB;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_card JSONB;

-- Garde-fous en base, en plus de la validation applicative : un objet JSON de taille bornée
-- (mêmes bornes que avatar_ring::RING_MAX_BYTES et profile_card::PROFILE_CARD_MAX_BYTES).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_avatar_ring_shape') THEN
        ALTER TABLE users ADD CONSTRAINT users_avatar_ring_shape
            CHECK (avatar_ring IS NULL
                   OR (jsonb_typeof(avatar_ring) = 'object'
                       AND octet_length(avatar_ring::text) <= 512)) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_profile_card_shape') THEN
        ALTER TABLE users ADD CONSTRAINT users_profile_card_shape
            CHECK (profile_card IS NULL
                   OR (jsonb_typeof(profile_card) = 'object'
                       AND octet_length(profile_card::text) <= 512)) NOT VALID;
    END IF;
END $$;

-- Anneau v2 (jusqu'à 8 couleurs et de nouveaux réglages) : la borne de l'anneau de serveur
-- passe de 256 à 512 octets. Toutes les lignes respectent déjà 256 (validé par la migration
-- 131), donc aussi 512 : la contrainte est revalidée sans rien rattraper.
ALTER TABLE server_members DROP CONSTRAINT IF EXISTS server_members_ring_size;
ALTER TABLE server_members ADD CONSTRAINT server_members_ring_size
    CHECK (server_avatar_ring IS NULL OR octet_length(server_avatar_ring::text) <= 512) NOT VALID;
ALTER TABLE server_members VALIDATE CONSTRAINT server_members_ring_size;
