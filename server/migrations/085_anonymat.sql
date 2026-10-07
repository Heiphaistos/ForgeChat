-- 083 — Anonymat : le serveur ne garde que le strict nécessaire.

-- Sessions : plus d'adresse IP ; l'appareil devient une étiquette (« Chrome · Windows »)
-- posée à la connexion. Les user-agents bruts déjà stockés sont effacés.
ALTER TABLE user_sessions DROP COLUMN IF EXISTS ip_address;
UPDATE user_sessions SET device_info = NULL;

-- Rapports d'erreurs : anonymes (plus de compte), user-agent réduit à navigateur + système.
ALTER TABLE client_reports DROP COLUMN IF EXISTS user_id;
UPDATE client_reports SET user_agent = NULL;

-- Colonne morte : jamais mise à jour, le compteur « en ligne » lit users.status.
ALTER TABLE users DROP COLUMN IF EXISTS last_seen;
