-- Réactions sur les messages de threads — parité avec canaux/DMs/groupes
CREATE TABLE IF NOT EXISTS thread_message_reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_message_id UUID NOT NULL REFERENCES thread_messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(thread_message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_thread_reactions_msg ON thread_message_reactions(thread_message_id);
