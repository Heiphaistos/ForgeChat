-- Un jeton push déjà lié à un compte ne change de propriétaire que si la demande vient de la
-- même installation de l'app (secret aléatoire tiré par l'app, stocké ici haché).
ALTER TABLE push_devices ADD COLUMN IF NOT EXISTS device_key_hash VARCHAR(64);
