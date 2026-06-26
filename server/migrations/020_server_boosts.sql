CREATE TABLE IF NOT EXISTS server_boosts (
    user_id    UUID NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    server_id  UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    boosted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, server_id)
);
