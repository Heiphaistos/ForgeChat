-- Modération de l'instance par El Patron (voir handlers/site_admin.rs) :
--  * supervisor : adhésion posée par une supervision (visible dans les membres et le journal du serveur,
--    exclue des destinataires de clés des salons chiffrés de bout en bout) ;
--  * suspended_* : serveur suspendu par l'administration (inaccessible à ses membres).
ALTER TABLE server_members ADD COLUMN IF NOT EXISTS supervisor BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS suspended_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_server_members_supervisor ON server_members (user_id) WHERE supervisor;
