-- Quota de stockage par compte : chaque pièce jointe connaît son expéditeur.
-- SET NULL : un compte supprimé ne doit pas emporter les lignes (les messages,
-- eux, passent au compte fantôme et gardent leurs fichiers).
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS uploader_id UUID REFERENCES users(id) ON DELETE SET NULL;

UPDATE attachments a SET uploader_id = m.user_id FROM messages m
 WHERE a.uploader_id IS NULL AND a.message_id = m.id;
UPDATE attachments a SET uploader_id = m.sender_id FROM dm_messages m
 WHERE a.uploader_id IS NULL AND a.dm_message_id = m.id;
UPDATE attachments a SET uploader_id = m.sender_id FROM group_dm_messages m
 WHERE a.uploader_id IS NULL AND a.group_dm_message_id = m.id;
UPDATE attachments a SET uploader_id = m.user_id FROM thread_messages m
 WHERE a.uploader_id IS NULL AND a.thread_message_id = m.id;
UPDATE attachments a SET uploader_id = m.user_id FROM forum_replies m
 WHERE a.uploader_id IS NULL AND a.forum_reply_id = m.id;

CREATE INDEX IF NOT EXISTS idx_attachments_uploader ON attachments (uploader_id) WHERE uploader_id IS NOT NULL;
