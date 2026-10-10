-- Centre de notifications : réglage par catégorie de salons, « ignorer les
-- mentions de rôles » et alerte « nouveau post de forum » par serveur.
-- Hiérarchie appliquée par notify.rs et le client : salon > catégorie > serveur > défaut.
ALTER TABLE notification_overrides_server ADD COLUMN IF NOT EXISTS suppress_roles BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE notification_overrides_server ADD COLUMN IF NOT EXISTS forum_posts BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS notification_overrides_category (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    level TEXT NOT NULL CHECK (level IN ('all', 'mentions', 'nothing')),
    PRIMARY KEY (user_id, category_id)
);
