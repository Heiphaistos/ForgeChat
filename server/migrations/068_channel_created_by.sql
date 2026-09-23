-- 068 — Créateur des salons et des catégories.
-- Sert au droit DELETE_OWN_CHANNELS (supprimer seulement ce qu'on a créé) et à
-- la protection des salons créés par le propriétaire du serveur (seuls le
-- propriétaire ou un administrateur peuvent les supprimer).
-- L'existant est attribué au propriétaire du serveur : tout salon antérieur
-- devient donc protégé.
ALTER TABLE channels ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;

UPDATE channels c SET created_by = s.owner_id
  FROM servers s WHERE s.id = c.server_id AND c.created_by IS NULL;
UPDATE categories c SET created_by = s.owner_id
  FROM servers s WHERE s.id = c.server_id AND c.created_by IS NULL;
