-- Réactions sur les réponses de forum — parité avec threads/groupes/canaux
CREATE TABLE IF NOT EXISTS forum_reply_reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    forum_reply_id UUID NOT NULL REFERENCES forum_replies(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(forum_reply_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_forum_reply_reactions_msg ON forum_reply_reactions(forum_reply_id);
