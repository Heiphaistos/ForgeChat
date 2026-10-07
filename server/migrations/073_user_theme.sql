-- Thème d'interface du compte, partagé entre le web, le bureau et le mobile (avant : localStorage).
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS theme VARCHAR(40);
