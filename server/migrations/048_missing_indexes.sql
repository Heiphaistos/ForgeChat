-- Indexes manquants pour les requêtes fréquentes

-- server_members par user_id : "quels serveurs rejoints par cet utilisateur ?"
-- Utilisé dans notifications WS, unread counts, etc.
CREATE INDEX IF NOT EXISTS idx_server_members_user
    ON server_members(user_id);

-- friendships par friend_id : "qui m'a envoyé une demande ?"
-- UNIQUE(user_id, friend_id) n'indexe pas friend_id seul
CREATE INDEX IF NOT EXISTS idx_friendships_friend
    ON friendships(friend_id, status);

-- dm_channels par user (les deux colonnes) : "mes DMs 1-1"
CREATE INDEX IF NOT EXISTS idx_dm_channels_user1
    ON dm_channels(user1_id);
CREATE INDEX IF NOT EXISTS idx_dm_channels_user2
    ON dm_channels(user2_id);

-- dm_messages par sender_id : queries d'agrégation (unread count exclut sender=$1)
CREATE INDEX IF NOT EXISTS idx_dm_messages_sender
    ON dm_messages(sender_id);

-- group_dm_messages par sender_id : même raison
CREATE INDEX IF NOT EXISTS idx_group_dm_messages_sender
    ON group_dm_messages(sender_id);

-- dm_user_settings : lookup mute/archive par utilisateur
CREATE INDEX IF NOT EXISTS idx_dm_user_settings_user
    ON dm_user_settings(user_id);

-- messages par created_at global : "mentions récentes tous canaux"
CREATE INDEX IF NOT EXISTS idx_messages_created_at
    ON messages(created_at DESC);
