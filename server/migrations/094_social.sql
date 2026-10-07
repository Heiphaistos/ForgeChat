-- Lot « Profil et social » (handlers/social.rs, birthdays.rs, badges.rs, presence.rs).

-- 31. Statut riche : « en appel » visible par tout le monde / amis / personne
-- (l'activité jeu / musique garde `activity_visibility`).
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS call_visibility VARCHAR(20) NOT NULL DEFAULT 'friends'
    CHECK (call_visibility IN ('everyone','friends','nobody'));

-- 32. Notes privées chiffrées par la clé de compte de leur auteur : le serveur ne garde
-- qu'un blob opaque {v, iv, ct}. `content` (ancien texte en clair) est vidé dès que
-- l'appli de l'auteur l'a rechiffré.
ALTER TABLE user_notes ADD COLUMN IF NOT EXISTS enc JSONB;
-- Les anciennes notes d'ami (route /friends/:id/note, jamais utilisée par les applis)
-- rejoignent les notes ordinaires pour être rechiffrées, puis disparaissent en clair.
INSERT INTO user_notes (user_id, target_user_id, content, updated_at)
    SELECT user_id, target_id, note, updated_at FROM friend_notes WHERE note <> ''
    ON CONFLICT (user_id, target_user_id) DO NOTHING;
DELETE FROM friend_notes;

-- 33. Anniversaires : jour et mois ; l'année est facultative et jamais montrée
-- (sans année, `birthday` est stocké en 2000, année bissextile pour le 29 février).
ALTER TABLE users ADD COLUMN IF NOT EXISTS birthday_has_year BOOLEAN NOT NULL DEFAULT TRUE;
-- nobody / friends / servers (= amis + membres des serveurs choisis).
ALTER TABLE users ADD COLUMN IF NOT EXISTS birthday_visibility VARCHAR(10) NOT NULL DEFAULT 'nobody'
    CHECK (birthday_visibility IN ('nobody','friends','servers'));
-- Dernière année fêtée : un anniversaire n'est annoncé qu'une fois par an.
ALTER TABLE users ADD COLUMN IF NOT EXISTS birthday_celebrated_year INT;
-- Les dates déjà saisies étaient annoncées partout : on garde au moins les amis.
UPDATE users SET birthday_visibility = 'friends' WHERE birthday IS NOT NULL;
CREATE TABLE IF NOT EXISTS birthday_servers (
    user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, server_id)
);
-- Salon où le serveur souhaite les anniversaires (NULL = message automatique désactivé).
ALTER TABLE servers ADD COLUMN IF NOT EXISTS birthday_channel_id UUID REFERENCES channels(id) ON DELETE SET NULL;

-- 34. Badges de succès : compteurs seulement (jamais de contenu).
CREATE TABLE IF NOT EXISTS user_stats (
    user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    messages_sent  BIGINT NOT NULL DEFAULT 0,
    first_voice_at TIMESTAMPTZ
);
-- Point de départ : messages déjà envoyés (hors webhooks et messages importés).
INSERT INTO user_stats (user_id, messages_sent)
SELECT uid, COUNT(*) FROM (
    SELECT user_id AS uid FROM messages WHERE user_id IS NOT NULL AND COALESCE(type, 'default') = 'default'
    UNION ALL SELECT sender_id FROM dm_messages
    UNION ALL SELECT sender_id FROM group_dm_messages
) m
WHERE EXISTS (SELECT 1 FROM users u WHERE u.id = m.uid)
GROUP BY uid
ON CONFLICT (user_id) DO NOTHING;
