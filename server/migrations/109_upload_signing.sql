-- F8 (audit 2026-10-10) : /uploads non public, URL signées.
-- Salon d'un média de forum (POST .../forum-uploads) : l'URL vit dans le contenu chiffré de la
-- publication, l'appli la fait signer par POST /api/uploads/sign, qui contrôle l'accès au salon.
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES channels(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS attachments_url_idx ON attachments (url);
