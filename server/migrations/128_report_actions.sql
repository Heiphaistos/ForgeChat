-- Historique des actions de modération prises depuis un signalement (amélioration n° 39).
CREATE TABLE IF NOT EXISTS report_actions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id    UUID NOT NULL REFERENCES message_reports(id) ON DELETE CASCADE,
    moderator_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action       VARCHAR(16) NOT NULL CHECK (action IN ('delete', 'timeout', 'kick', 'ban', 'resolve', 'dismiss')),
    detail       TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_report_actions_report ON report_actions(report_id, created_at);

-- Un signalement survit à la suppression du message signalé (preuve et historique pour les
-- modérateurs) : plus de clé étrangère en cascade. Purgé ensuite selon RETENTION_REPORTS_DAYS.
ALTER TABLE message_reports DROP CONSTRAINT IF EXISTS message_reports_message_id_fkey;
