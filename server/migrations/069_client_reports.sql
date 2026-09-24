-- 069 — Rapports d'erreurs envoyés par les applis (web, Windows, Linux).
-- Alimentée par POST /api/diagnostics/report (public, limité par IP), lue par
-- /api/admin/diagnostics (comptes de FORGECHAT_ADMIN_USER_IDS). Une même
-- erreur (même empreinte) incrémente `count` au lieu de créer une ligne.
-- Purge automatique après 30 jours (boucle de maintenance de main.rs).
CREATE TABLE IF NOT EXISTS client_reports (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    platform    VARCHAR(16) NOT NULL,
    app_version VARCHAR(64),
    kind        VARCHAR(32) NOT NULL,
    message     TEXT NOT NULL DEFAULT '',
    stack       TEXT,
    log         TEXT,
    user_agent  TEXT,
    url         TEXT,
    fingerprint VARCHAR(64) NOT NULL,
    count       INTEGER NOT NULL DEFAULT 1,
    last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_reports_fingerprint ON client_reports(fingerprint);
CREATE INDEX IF NOT EXISTS idx_client_reports_last_seen ON client_reports(last_seen DESC);
