-- Fils et forums : pièces jointes, réponse à un message de fil, non-lus des fils,
-- index de pagination par curseur (created_at, id).

-- Pièces jointes : même table que les salons/MP/groupes, une colonne propriétaire par source.
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS thread_message_id UUID REFERENCES thread_messages(id) ON DELETE CASCADE;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS forum_reply_id UUID REFERENCES forum_replies(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_attachments_thread_message ON attachments (thread_message_id) WHERE thread_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attachments_forum_reply ON attachments (forum_reply_id) WHERE forum_reply_id IS NOT NULL;

-- Réponse à un message du même fil (le message cité peut disparaître : SET NULL).
ALTER TABLE thread_messages ADD COLUMN IF NOT EXISTS reply_to UUID REFERENCES thread_messages(id) ON DELETE SET NULL;

-- Non-lus : horodatage du dernier message lu par utilisateur et par fil.
-- Une ligne = l'utilisateur suit le fil (créateur, participant ou lecteur).
CREATE TABLE IF NOT EXISTS thread_reads (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, thread_id)
);
CREATE INDEX IF NOT EXISTS idx_thread_reads_thread ON thread_reads (thread_id);

-- Pagination par curseur composite (évite de sauter les horodatages identiques).
CREATE INDEX IF NOT EXISTS idx_thread_messages_thread_cursor ON thread_messages (thread_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_forum_replies_post_cursor ON forum_replies (post_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_threads_channel_activity ON threads (channel_id, (COALESCE(last_reply_at, created_at)) DESC, id DESC);
