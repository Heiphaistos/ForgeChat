-- Index composé pour les filtres par action dans le journal d'audit
CREATE INDEX IF NOT EXISTS idx_audit_log_server_action
    ON audit_log(server_id, action, created_at DESC);
