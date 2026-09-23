-- 063 — Suppression de compte, hiérarchie des rôles, index manquants.

-- ── 1. Suppression de compte ──────────────────────────────────────────────
-- Dix clés étrangères vers users n'avaient aucune action ON DELETE : supprimer
-- son compte échouait en 500 dès qu'on avait posté un seul message (droit à
-- l'effacement inopérant). Comme Discord, les contenus restent et passent à
-- « Utilisateur supprimé » : un compte fantôme fixe, impossible à connecter
-- (le hachage « ! » ne correspond à aucun mot de passe bcrypt).
INSERT INTO users (id, username, discriminator, email, password_hash, status)
VALUES ('00000000-0000-0000-0000-00000000dead', 'Utilisateur supprimé', '0000',
        'deleted-user@forgechat.invalid', '!', 'offline')
ON CONFLICT (id) DO NOTHING;

-- Colonnes obligatoires : réattribuées au compte fantôme.
DO $$
DECLARE
    t RECORD;
BEGIN
    FOR t IN SELECT * FROM (VALUES
        ('messages', 'user_id', 'messages_user_id_fkey'),
        ('dm_messages', 'sender_id', 'dm_messages_sender_id_fkey'),
        ('threads', 'creator_id', 'threads_creator_id_fkey'),
        ('thread_messages', 'user_id', 'thread_messages_user_id_fkey'),
        ('forum_posts', 'creator_id', 'forum_posts_creator_id_fkey'),
        ('forum_replies', 'user_id', 'forum_replies_user_id_fkey'),
        ('tickets', 'creator_id', 'tickets_creator_id_fkey')
    ) AS v(tbl, col, fk)
    LOOP
        EXECUTE format('ALTER TABLE %I ALTER COLUMN %I SET DEFAULT %L::uuid', t.tbl, t.col, '00000000-0000-0000-0000-00000000dead');
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t.tbl, t.fk);
        EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES users(id) ON DELETE SET DEFAULT', t.tbl, t.fk, t.col);
    END LOOP;
END $$;

-- Colonnes facultatives : simplement vidées.
ALTER TABLE pinned_messages DROP CONSTRAINT IF EXISTS pinned_messages_pinned_by_fkey;
ALTER TABLE pinned_messages ADD CONSTRAINT pinned_messages_pinned_by_fkey
    FOREIGN KEY (pinned_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_creator_id_fkey;
ALTER TABLE invites ADD CONSTRAINT invites_creator_id_fkey
    FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_assigned_to_fkey;
ALTER TABLE tickets ADD CONSTRAINT tickets_assigned_to_fkey
    FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL;

-- ── 2. Positions des rôles ────────────────────────────────────────────────
-- Tous les rôles étaient créés en position 0 : aucune hiérarchie possible.
-- Sur les serveurs où des rôles partagent une position, on attribue des
-- positions distinctes en gardant l'ordre actuel puis l'ancienneté (le premier
-- rôle créé reste le plus haut, comme sur Discord où un nouveau rôle arrive en
-- bas). @everyone reste à 0. Les serveurs importés, déjà ordonnés, ne bougent pas.
WITH dup AS (
    SELECT server_id FROM roles WHERE NOT is_everyone
    GROUP BY server_id HAVING COUNT(*) <> COUNT(DISTINCT position)
), ranked AS (
    SELECT r.id,
           COUNT(*) OVER (PARTITION BY r.server_id)
             - ROW_NUMBER() OVER (PARTITION BY r.server_id ORDER BY r.position DESC, r.created_at ASC, r.id)
             + 1 AS new_pos
    FROM roles r JOIN dup d ON d.server_id = r.server_id
    WHERE NOT r.is_everyone
)
UPDATE roles r SET position = ranked.new_pos FROM ranked WHERE r.id = ranked.id;
UPDATE roles SET position = 0 WHERE is_everyone;

-- ── 3. Index manquants sur des clés étrangères référençantes ──────────────
-- Sans eux, chaque suppression de message parcourait toute la table pour
-- `reply_to`, et la suppression d'un salon ou d'un serveur devenait quadratique.
CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages (reply_to) WHERE reply_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_threads_parent_message ON threads (parent_message_id) WHERE parent_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pinned_messages_message ON pinned_messages (message_id);
CREATE INDEX IF NOT EXISTS idx_dm_messages_reply_to ON dm_messages (reply_to_id) WHERE reply_to_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attachments_dm_message ON attachments (dm_message_id) WHERE dm_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attachments_group_dm_message ON attachments (group_dm_message_id) WHERE group_dm_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_group_dm_messages_reply_to ON group_dm_messages (reply_to) WHERE reply_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_message_reports_message ON message_reports (message_id);
