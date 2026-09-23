-- Migration 065 : mentions résolues côté serveur, réglages de notification
-- complets (couper temporairement, ignorer @everyone) et abonnements Web Push.

-- Une ligne par destinataire effectivement mentionné (<@id>, rôle mentionnable,
-- @everyone / @here autorisés, réponse). Remplace le ILIKE '%@pseudo%' sur 7 jours.
CREATE TABLE IF NOT EXISTS message_mentions (
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS message_mentions_user_created ON message_mentions(user_id, created_at DESC);

-- « Couper pendant 15 min / 1 h / 8 h / 24 h » : muted_until NULL = jusqu'à réactivation.
ALTER TABLE notification_overrides_channel ADD COLUMN IF NOT EXISTS muted_until TIMESTAMPTZ;
ALTER TABLE notification_overrides_server ADD COLUMN IF NOT EXISTS suppress_everyone BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint   TEXT NOT NULL UNIQUE,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user ON push_subscriptions(user_id);
