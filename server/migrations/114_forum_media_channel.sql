-- Audit 2026-10-10, phase 4 : médias de forum téléversés avant la migration 109 (salon inconnu).
-- Le salon est repris de la publication qui les affiche (forum_posts.media_url, seule colonne en
-- clair qui pointe vers une pièce jointe sans propriétaire). Ceux qui restent sans salon ne sont
-- signés (POST /api/uploads/sign) que pour leur auteur, ou s'ils sont chiffrés (`.enc`).
UPDATE attachments a SET channel_id = p.channel_id
FROM forum_posts p
WHERE p.media_url = a.url
  AND a.channel_id IS NULL
  AND a.message_id IS NULL AND a.thread_message_id IS NULL AND a.forum_reply_id IS NULL
  AND a.dm_message_id IS NULL AND a.group_dm_message_id IS NULL;
