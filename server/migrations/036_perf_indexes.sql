-- Indexes manquants pour les requêtes fréquentes

-- messages.user_id : leaderboard, recherche par auteur
CREATE INDEX IF NOT EXISTS messages_user_id ON messages(user_id);

-- attachments.message_id : requête batch ANY($1::uuid[])
CREATE INDEX IF NOT EXISTS attachments_message_id ON attachments(message_id);

-- refresh_tokens.user_id : DELETE WHERE user_id=$1 au logout
CREATE INDEX IF NOT EXISTS refresh_tokens_user_id ON refresh_tokens(user_id);

-- reactions.user_id : "les réactions de cet utilisateur"
CREATE INDEX IF NOT EXISTS reactions_user_id ON reactions(user_id);

-- dm_messages : requêtes dans un canal DM, triées par date
CREATE INDEX IF NOT EXISTS dm_messages_channel_created ON dm_messages(dm_channel_id, created_at DESC);
