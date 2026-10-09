-- Préférences de la page Actualités (thème de navigation, épinglées, ordre, sources coupées, groupes repliés),
-- synchronisées entre appareils. Forme libre côté client : le serveur ne l'interprète pas.
CREATE TABLE IF NOT EXISTS user_news_prefs (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    prefs JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
