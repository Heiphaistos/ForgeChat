-- Migration 070 : téléphones enregistrés pour les notifications push de l'app
-- mobile (jeton Expo). Un jeton identifie un téléphone : ré-enregistré par un
-- autre compte, il change de propriétaire (UNIQUE), l'ancien ne reçoit plus rien.
CREATE TABLE IF NOT EXISTS push_devices (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token        VARCHAR(255) NOT NULL UNIQUE,
    platform     VARCHAR(10)  NOT NULL CHECK (platform IN ('android', 'ios')),
    show_preview BOOLEAN      NOT NULL DEFAULT FALSE,
    device_name  VARCHAR(64),
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS push_devices_user ON push_devices(user_id);
