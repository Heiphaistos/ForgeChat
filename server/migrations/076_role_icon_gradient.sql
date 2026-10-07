-- Rôles : icône (emoji unicode ou image téléversée /uploads/role-icons/…) et
-- seconde couleur pour un pseudo en dégradé (color → secondary_color).
ALTER TABLE roles ADD COLUMN IF NOT EXISTS secondary_color INT;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS icon TEXT;
