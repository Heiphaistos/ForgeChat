-- Salons médias (channels.type = 'media', VARCHAR sans contrainte CHECK) : un
-- forum affiché en grille dont chaque publication porte un média (image/vidéo).
ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS media_url TEXT;
