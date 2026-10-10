-- Enveloppes signalées illisibles par leur destinataire (audit 2026-10-10, M4) :
-- l'enveloppe est supprimée pour qu'un autre détenteur la redonne, et son auteur
-- ne peut plus en déposer pour ce membre et cette époque.
CREATE TABLE IF NOT EXISTS conversation_key_reports (
    conv_kind  TEXT NOT NULL,
    conv_id    UUID NOT NULL,
    epoch      INT  NOT NULL,
    member_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wrapped_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (conv_kind, conv_id, epoch, member_id, wrapped_by)
);
