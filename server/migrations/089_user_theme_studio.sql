-- Thèmes perso et disposition de l'interface, synchronisés entre le web, le bureau et le mobile.
-- Forme libre côté client (validée à la lecture par chaque application) : le serveur borne la taille.
-- Numéro 089 : 088 est pris par la branche profil-custom.
CREATE TABLE IF NOT EXISTS user_theme_studio (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
