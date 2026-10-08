-- Le rôle de site s'appelle « El Patron » (clé `el-patron`) et il est tout-puissant :
-- `fc_is_god(user)` vaut vrai pour le propriétaire du site (e-mail `owner_email`, posé au démarrage
-- depuis FORGECHAT_ADMIN_EMAIL) et pour les détenteurs du rôle. Les calculs de permissions la
-- traitent comme « propriétaire » de chaque serveur dont le compte est membre.
ALTER TABLE site_role_members DROP CONSTRAINT IF EXISTS site_role_members_role_check;
UPDATE site_role_members SET role = 'el-patron' WHERE role = 'l-patron';
ALTER TABLE site_role_members ADD CONSTRAINT site_role_members_role_check CHECK (role IN ('el-patron'));

CREATE OR REPLACE FUNCTION fc_is_god(uid uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM users u
        WHERE u.id = uid AND NOT u.is_bot AND (
            lower(u.email) = COALESCE((SELECT value FROM site_settings WHERE key = 'owner_email'), 'heiphaistos44@gmail.com')
            OR EXISTS (SELECT 1 FROM site_role_members r WHERE r.user_id = u.id AND r.role = 'el-patron')
        )
    )
$$;
