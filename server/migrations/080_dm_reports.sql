-- Signalements de messages privés : pas de modérateurs de serveur, ils vont aux administrateurs du
-- site (FORGECHAT_ADMIN_USER_IDS). Le contenu est copié au moment du signalement (preuve conservée
-- même si l'auteur supprime son message).
CREATE TABLE IF NOT EXISTS dm_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID REFERENCES dm_messages(id) ON DELETE SET NULL,
    reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    reason VARCHAR(20) NOT NULL,
    comment TEXT,
    content TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (reporter_id, message_id)
);
CREATE INDEX IF NOT EXISTS dm_reports_status ON dm_reports(status, created_at DESC);
