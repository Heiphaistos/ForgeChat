-- Indices de performance pour les requêtes fréquentes

-- Suivi spam messages (query à chaque envoi de message)
CREATE INDEX IF NOT EXISTS idx_message_spam_track_user_channel
    ON message_spam_track(user_id, channel_id);

-- Rappels messages (query toutes les 30 secondes)
CREATE INDEX IF NOT EXISTS idx_message_reminders_remind_at
    ON message_reminders(remind_at)
    WHERE sent = FALSE;

-- Messages éphémères (query toutes les 60 secondes)
CREATE INDEX IF NOT EXISTS idx_messages_expires_at
    ON messages(expires_at)
    WHERE expires_at IS NOT NULL;

-- Friendships : acceptation et lookup bidirectionnel
CREATE INDEX IF NOT EXISTS idx_friendships_status
    ON friendships(status)
    WHERE status = 'pending';
