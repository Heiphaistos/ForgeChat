-- Protection du compte (audit 2026-10-12, améliorations n° 4 et 25).
-- Appareils connus : seulement l'empreinte SHA-256 d'un identifiant aléatoire de 256 bits gardé
-- par l'appareil (cookie HttpOnly sur le web, trousseau sur les applis), son étiquette
-- (« Firefox sur Windows ») et les dates. Ni IP ni user-agent brut.
CREATE TABLE IF NOT EXISTS known_devices (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_hash TEXT NOT NULL,
    label       TEXT,
    first_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, device_hash)
);

-- Verrouillage d'urgence : toutes les sessions fermées, connexion refusée jusqu'à la
-- réinitialisation du mot de passe (qui remet la colonne à NULL).
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
