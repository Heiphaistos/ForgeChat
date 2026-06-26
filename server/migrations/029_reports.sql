CREATE TABLE IF NOT EXISTS message_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    comment TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(reporter_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_reports_server ON message_reports(server_id, status);
