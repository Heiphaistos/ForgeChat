-- Fonctions façon Discord (serveurs) :
--  * surcharges de permissions d'une catégorie, recopiées sur ses salons à la demande
--    (« Synchroniser les permissions ») et à la création d'un salon dans la catégorie ;
--  * statut d'un salon vocal (texte libre court, comme Discord) ;
--  * forum : réaction par défaut et consignes de publication ;
--  * suivi des invitations : code utilisé par chaque membre pour rejoindre ;
--  * comptes connectés : affichés sur le profil public seulement si le titulaire le choisit.

CREATE TABLE IF NOT EXISTS category_permissions (
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    target_id UUID NOT NULL,
    target_type VARCHAR(8) NOT NULL CHECK (target_type IN ('role', 'member')),
    allow BIGINT NOT NULL DEFAULT 0 CHECK (allow >= 0),
    deny BIGINT NOT NULL DEFAULT 0 CHECK (deny >= 0),
    PRIMARY KEY (category_id, target_id)
);

-- VARCHAR(n) compte des caractères : mêmes bornes que la validation applicative.
ALTER TABLE channels ADD COLUMN IF NOT EXISTS voice_status VARCHAR(500);
ALTER TABLE channels ADD COLUMN IF NOT EXISTS default_reaction_emoji VARCHAR(64);
ALTER TABLE channels ADD COLUMN IF NOT EXISTS post_guidelines VARCHAR(2000);

-- Code d'invitation (table invites) utilisé pour rejoindre. Pas de clé étrangère :
-- l'historique survit à la suppression de l'invitation. NULL = adresse publique,
-- adresse personnalisée, ou membre arrivé avant cette migration.
ALTER TABLE server_members ADD COLUMN IF NOT EXISTS joined_via_invite VARCHAR(16);
CREATE INDEX IF NOT EXISTS idx_server_members_invite
    ON server_members (server_id, joined_via_invite) WHERE joined_via_invite IS NOT NULL;

-- Masqué par défaut (audit C12) : rien n'est exposé sans action du titulaire.
ALTER TABLE connected_accounts ADD COLUMN IF NOT EXISTS visible BOOLEAN NOT NULL DEFAULT FALSE;
