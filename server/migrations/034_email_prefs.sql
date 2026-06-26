-- Migration 034: Email notification preferences
CREATE TABLE IF NOT EXISTS email_preferences (
    user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    dm_unread_notify BOOLEAN NOT NULL DEFAULT FALSE,
    last_notified_at TIMESTAMPTZ
);
