-- Apparence d'un serveur choisie par son propriétaire (bannière, accent, fonds, icône,
-- nom, accueil, rôles…), vue par tous les membres. Document JSON validé et normalisé
-- par models/server_look.rs (champs inconnus refusés, identifiants en liste blanche,
-- couleurs 0xRRGGBB, nombres bornés, images seulement parmi nos propres envois).
-- Ici, garde-fou en base : un objet JSON de taille bornée, ou NULL (= apparence par défaut).

ALTER TABLE servers ADD COLUMN IF NOT EXISTS look JSONB;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'servers_look_shape') THEN
        ALTER TABLE servers ADD CONSTRAINT servers_look_shape
            CHECK (look IS NULL OR (jsonb_typeof(look) = 'object' AND octet_length(look::text) <= 4096));
    END IF;
END $$;
