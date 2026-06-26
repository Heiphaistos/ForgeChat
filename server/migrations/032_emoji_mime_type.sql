-- ForgeChat — Ajout mime_type sur custom_emojis pour support GIF animés
ALTER TABLE custom_emojis ADD COLUMN IF NOT EXISTS mime_type VARCHAR(50) NOT NULL DEFAULT 'image/png';
