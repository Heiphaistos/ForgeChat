-- 066 — Supprimer un message auquel quelqu'un a répondu, ou d'où part un fil,
-- échouait : `messages.reply_to` et `threads.parent_message_id` n'avaient
-- aucune action ON DELETE. La purge du panneau d'administration s'arrêtait
-- donc en erreur dès qu'un message visé était cité, et la suppression d'un
-- seul message cité aussi. Comme Discord : la réponse reste, sans citation,
-- et le fil reste, détaché de son message d'origine.
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_reply_to_fkey;
ALTER TABLE messages ADD CONSTRAINT messages_reply_to_fkey
    FOREIGN KEY (reply_to) REFERENCES messages(id) ON DELETE SET NULL;

ALTER TABLE threads DROP CONSTRAINT IF EXISTS threads_parent_message_id_fkey;
ALTER TABLE threads ADD CONSTRAINT threads_parent_message_id_fkey
    FOREIGN KEY (parent_message_id) REFERENCES messages(id) ON DELETE SET NULL;
