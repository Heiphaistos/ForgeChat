-- Profil par serveur : avatar, bannière et bio propres à un serveur, en plus du surnom.
-- NULL = on retombe sur le profil global du compte.
ALTER TABLE server_members ADD COLUMN IF NOT EXISTS server_avatar TEXT;
ALTER TABLE server_members ADD COLUMN IF NOT EXISTS server_banner TEXT;
ALTER TABLE server_members ADD COLUMN IF NOT EXISTS server_bio VARCHAR(190);
