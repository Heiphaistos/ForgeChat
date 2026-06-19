-- Abonnements flux RSS/YouTube par canal
CREATE TABLE channel_feeds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    feed_url TEXT NOT NULL,
    feed_type VARCHAR(20) NOT NULL DEFAULT 'rss',
    last_checked_at TIMESTAMPTZ,
    last_item_guid TEXT,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(channel_id, feed_url)
);

CREATE INDEX channel_feeds_enabled ON channel_feeds(enabled, last_checked_at);
