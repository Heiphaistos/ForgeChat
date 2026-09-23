-- 064 — Statut choisi distinct du statut en direct, modération vocale.

-- ── 1. Présence (audit P1-3) ──────────────────────────────────────────────
-- `users.status` servait à la fois de préférence et d'état en direct : la
-- connexion remplaçait « ne pas déranger » par « en ligne » et la déconnexion
-- du dernier appareil écrasait « invisible » par « hors ligne ».
-- Désormais : `preferred_status` = choix de l'utilisateur (persisté),
-- `status` = ce que voient les autres (hors ligne sans session, sinon le choix,
-- « invisible » apparaissant hors ligne).
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_status VARCHAR(16) NOT NULL DEFAULT 'online';
UPDATE users SET preferred_status = status WHERE status IN ('dnd', 'invisible');
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_preferred_status_check;
ALTER TABLE users ADD CONSTRAINT users_preferred_status_check
    CHECK (preferred_status IN ('online', 'idle', 'dnd', 'invisible'));
-- « invisible » n'est plus un statut en direct : il apparaît hors ligne.
UPDATE users SET status = 'offline' WHERE status = 'invisible';

-- ── 2. Modération vocale (audit P2-2) ─────────────────────────────────────
-- Muet / sourdine imposés par un modérateur, comme Discord : ils suivent le
-- membre d'un salon vocal à l'autre et survivent à une reconnexion, et
-- l'utilisateur ne peut pas les lever lui-même.
ALTER TABLE server_members ADD COLUMN IF NOT EXISTS voice_muted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE server_members ADD COLUMN IF NOT EXISTS voice_deafened BOOLEAN NOT NULL DEFAULT FALSE;
