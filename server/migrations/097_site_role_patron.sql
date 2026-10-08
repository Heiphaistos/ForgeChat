-- Rôle de site « L-Patron » : seuls ses membres (et le propriétaire du site) accèdent à l'administration.
-- Seul le propriétaire (FORGECHAT_ADMIN_EMAIL) peut l'attribuer ou le retirer (handlers/site_admin.rs).
CREATE TABLE IF NOT EXISTS site_role_members (
    role       TEXT NOT NULL CHECK (role IN ('l-patron')),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (role, user_id)
);
