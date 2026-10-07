-- Personnalisation du profil, gratuite pour tous (models/profile_style.rs) :
-- nom d'affichage, style du pseudo (couleur unie/dégradé, effet, police, JSON validé
-- par liste blanche côté serveur), étiquette perso, liens https et expiration du
-- statut personnalisé.
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(32);
ALTER TABLE users ADD COLUMN IF NOT EXISTS name_style JSONB;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_tag VARCHAR(16);
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_links JSONB;
ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_status_expires_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_users_custom_status_expiry
    ON users (custom_status_expires_at) WHERE custom_status_expires_at IS NOT NULL;

-- Dans un serveur, la couleur du rôle le plus haut remplace la couleur perso du pseudo
-- (défaut, comme Discord) ; le propriétaire peut laisser chacun garder la sienne.
ALTER TABLE servers ADD COLUMN IF NOT EXISTS role_color_overrides_name BOOLEAN NOT NULL DEFAULT TRUE;
