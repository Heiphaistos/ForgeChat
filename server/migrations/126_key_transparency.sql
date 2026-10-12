-- Journal de transparence des clés de compte (audit 2026-10-12, amélioration n° 10).
-- Ajout seul, chaîné : hash = SHA-256("fc-kt-v1|seq|user_tag|key_hash|prev_hash"). Aucun
-- identifiant en clair : user_tag = SHA-256("fc-kt-user|<uuid>"), key_hash = SHA-256(clé publique).
-- Chaque appareil vérifie que la chaîne n'a jamais été réécrite et qu'aucune clé inconnue n'a été
-- publiée pour son propre compte (server/src/key_log.rs, client/src/e2e/keyTransparency.ts).
CREATE TABLE IF NOT EXISTS key_transparency_log (
    seq        BIGINT PRIMARY KEY,
    user_tag   CHAR(64) NOT NULL,
    key_hash   CHAR(64) NOT NULL,
    prev_hash  CHAR(64) NOT NULL,
    hash       CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kt_user_tag ON key_transparency_log(user_tag, seq DESC);

-- Jamais de modification ni de suppression, même par erreur de code.
CREATE OR REPLACE FUNCTION key_transparency_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'key_transparency_log est en ajout seul';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS key_transparency_no_change ON key_transparency_log;
CREATE TRIGGER key_transparency_no_change BEFORE UPDATE OR DELETE ON key_transparency_log
    FOR EACH ROW EXECUTE FUNCTION key_transparency_append_only();
