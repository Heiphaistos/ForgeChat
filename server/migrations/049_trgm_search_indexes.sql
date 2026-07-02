-- Trigram indexes for fast ILIKE '%pattern%' searches
-- pg_trgm enables GIN indexes that support leading-wildcard LIKE/ILIKE

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Messages content search (most expensive — largest table)
CREATE INDEX IF NOT EXISTS idx_messages_content_trgm
    ON messages USING GIN (content gin_trgm_ops);

-- Usernames search (global search + friend lookup)
CREATE INDEX IF NOT EXISTS idx_users_username_trgm
    ON users USING GIN (username gin_trgm_ops);

-- Server names discovery
CREATE INDEX IF NOT EXISTS idx_servers_name_trgm
    ON servers USING GIN (name gin_trgm_ops);

-- Channel names (per-server search)
CREATE INDEX IF NOT EXISTS idx_channels_name_trgm
    ON channels USING GIN (name gin_trgm_ops);
