-- Connexion v2 (docs/CHIFFREMENT-E2E.md §3) : le serveur ne reçoit plus le mot de passe.
-- auth_hash = bcrypt(auth), auth = HKDF(PBKDF2(mot de passe, kdf_salt)) calculé sur l'appareil.
-- Compte non migré : auth_hash NULL, password_hash = bcrypt(mot de passe) jusqu'à la prochaine connexion.
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS kdf_salt TEXT;

-- Inscription : tout compte prouve son e-mail (code à 6 chiffres) avant d'exister.
-- Les inscriptions en attente d'avant (mot de passe en clair côté serveur) sont abandonnées.
DELETE FROM pending_registrations;
ALTER TABLE pending_registrations ALTER COLUMN code TYPE VARCHAR(8);
ALTER TABLE pending_registrations ADD COLUMN IF NOT EXISTS auth_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE pending_registrations ADD COLUMN IF NOT EXISTS kdf_salt TEXT NOT NULL DEFAULT '';
ALTER TABLE pending_registrations ADD COLUMN IF NOT EXISTS invite_code TEXT;

-- El Patron : le propriétaire du site est un COMPTE (UUID), plus une adresse e-mail. Un compte
-- supprimé puis recréé avec la même adresse n'hérite plus de rien.
INSERT INTO site_settings (key, value)
SELECT 'owner_user_id', u.id::text FROM users u
 WHERE NOT u.is_bot
   AND lower(u.email) = COALESCE((SELECT value FROM site_settings WHERE key = 'owner_email'), 'heiphaistos44@gmail.com')
 ORDER BY u.created_at LIMIT 1
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION fc_is_god(uid uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM users u
        WHERE u.id = uid AND NOT u.is_bot AND (
            u.id::text = (SELECT value FROM site_settings WHERE key = 'owner_user_id')
            OR EXISTS (SELECT 1 FROM site_role_members r WHERE r.user_id = u.id AND r.role = 'el-patron')
        )
    )
$$;
