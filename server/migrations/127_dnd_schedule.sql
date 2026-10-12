-- « Ne pas déranger » programmé (audit 2026-10-12, amélioration n° 48), appliqué par le serveur
-- aux notifications push (web, Android, iOS). `days` : bits lundi (1) … dimanche (64), jour où
-- la plage COMMENCE (22:00 → 07:00 le vendredi couvre la nuit de vendredi à samedi).
CREATE TABLE IF NOT EXISTS dnd_schedules (
    user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    enabled         BOOLEAN NOT NULL DEFAULT FALSE,
    days            SMALLINT NOT NULL DEFAULT 127 CHECK (days BETWEEN 0 AND 127),
    start_min       SMALLINT NOT NULL DEFAULT 1320 CHECK (start_min BETWEEN 0 AND 1439),
    end_min         SMALLINT NOT NULL DEFAULT 420 CHECK (end_min BETWEEN 0 AND 1439),
    tz              VARCHAR(64) NOT NULL DEFAULT 'Europe/Paris',
    allow_favorites BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
