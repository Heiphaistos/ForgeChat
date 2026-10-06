-- Adresse d'invitation personnalisée (forgechat.heiphaistos.org/invite/<adresse>) : unique, sans
-- tenir compte de la casse. Format vérifié par le serveur (3-30 caractères a-z, 0-9, tiret).
UPDATE servers SET vanity_url = NULL WHERE vanity_url = '';
CREATE UNIQUE INDEX IF NOT EXISTS servers_vanity_url_lower ON servers (lower(vanity_url)) WHERE vanity_url IS NOT NULL;
