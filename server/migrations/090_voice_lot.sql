-- Lot « Vocal, vidéo et stream » (2026-10-07).
-- Salle d'attente : les arrivants attendent qu'un modérateur (MOVE_MEMBERS) les fasse entrer.
ALTER TABLE channels ADD COLUMN IF NOT EXISTS waiting_room BOOLEAN NOT NULL DEFAULT FALSE;

-- Sons perso du soundboard : à l'utilisateur, jouables dans tous ses salons vocaux.
CREATE TABLE IF NOT EXISTS user_sounds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    emoji VARCHAR(10),
    file_url TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS user_sounds_user ON user_sounds(user_id);
