-- Durcissement métier : qui peut publier dans « À la une » (réglé par El Patron), et qui a fermé un ticket.

-- Les sites d'actualités d'un serveur ne sont publics (page Actualités de tous les comptes) que si
-- l'administration du site l'a autorisé : avant, le bot de n'importe quel serveur y publiait.
ALTER TABLE servers ADD COLUMN IF NOT EXISTS news_public_allowed BOOLEAN NOT NULL DEFAULT FALSE;
-- Les serveurs qui publient déjà des sites publics gardent leur droit (pas de régression au déploiement).
UPDATE servers SET news_public_allowed = TRUE
 WHERE id IN (SELECT server_id FROM news_sites WHERE public);

-- Auteur de la fermeture d'un ticket : le créateur ne rouvre que ce qu'il a fermé lui-même
-- (un ticket fermé par l'équipe le reste).
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Membres exclus d'un groupe privé par son propriétaire : eux seuls peuvent les réinviter.
CREATE TABLE IF NOT EXISTS group_dm_excluded (
    dm_id       UUID NOT NULL REFERENCES group_dm_channels(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    excluded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (dm_id, user_id)
);
