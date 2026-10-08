-- Administration du site : inscription sur invitation, bannissement global, journal des actions.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_site_admin BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS site_banned_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS site_ban_reason TEXT,
    ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS registration_invite_id UUID;

CREATE TABLE IF NOT EXISTS site_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Cercle privé par défaut : plus d'inscription libre sans code d'invitation.
-- (Tant qu'aucun compte n'existe, la première inscription reste possible.)
INSERT INTO site_settings (key, value) VALUES ('registration_mode', 'invite') ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS registration_invites (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code       TEXT NOT NULL UNIQUE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    note       TEXT,
    max_uses   INT  NOT NULL DEFAULT 1 CHECK (max_uses BETWEEN 1 AND 1000),
    uses       INT  NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS registration_invite_uses (
    invite_id UUID NOT NULL REFERENCES registration_invites(id) ON DELETE CASCADE,
    user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    used_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (invite_id, user_id)
);

CREATE TABLE IF NOT EXISTS admin_audit (
    id             BIGSERIAL PRIMARY KEY,
    admin_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    action         TEXT NOT NULL,
    target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    detail         JSONB,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_site_banned ON users (site_banned_at) WHERE site_banned_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_invited_by ON users (invited_by);
