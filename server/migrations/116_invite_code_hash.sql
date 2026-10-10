-- Audit 2026-10-10, phase 4 : codes d'invitation au site hachés.
-- `code_hash` = SHA-256 hexadécimal du code normalisé (majuscules, sans tiret) ; `code_preview` =
-- ses 4 derniers caractères (liste admin « ••••ABCD »). Les codes existants (12 caractères,
-- ~59 bits) restent utilisables ; les nouveaux en ont 20 (~99 bits).
-- pending_registrations.invite_code garde désormais l'empreinte du code saisi, plus le code.
ALTER TABLE registration_invites ADD COLUMN IF NOT EXISTS code_hash TEXT;
ALTER TABLE registration_invites ADD COLUMN IF NOT EXISTS code_preview TEXT NOT NULL DEFAULT '';
UPDATE registration_invites
   SET code_hash = encode(sha256(convert_to(code, 'UTF8')), 'hex'), code_preview = right(code, 4);
ALTER TABLE registration_invites ALTER COLUMN code_hash SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS registration_invites_code_hash_idx ON registration_invites (code_hash);
ALTER TABLE registration_invites DROP COLUMN code;
DELETE FROM pending_registrations WHERE invite_code IS NOT NULL;
