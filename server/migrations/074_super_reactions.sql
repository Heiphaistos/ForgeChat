-- Super réactions (gratuites ici, payantes chez Discord) : comptées à part des
-- réactions normales, un même emoji peut donc être posé une fois de chaque sorte.
ALTER TABLE reactions ADD COLUMN IF NOT EXISTS is_super BOOLEAN NOT NULL DEFAULT FALSE;
-- L'unicité (message, utilisateur, emoji) de 001 devient (…, is_super) : on retire
-- la contrainte quel que soit son nom (seule contrainte UNIQUE de la table).
DO $$
DECLARE c text;
BEGIN
    FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'reactions'::regclass AND contype = 'u' LOOP
        EXECUTE format('ALTER TABLE reactions DROP CONSTRAINT %I', c);
    END LOOP;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS reactions_message_user_emoji_kind
    ON reactions(message_id, user_id, emoji, is_super);

-- Journal des super réactions posées : la limite quotidienne se compte ici, pour
-- qu'en retirer une ne rende pas le crédit (sinon poser/retirer en boucle rejoue
-- l'animation chez tout le monde sans fin).
CREATE TABLE IF NOT EXISTS super_reaction_uses (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS super_reaction_uses_user_time ON super_reaction_uses(user_id, used_at);
