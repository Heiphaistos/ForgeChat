-- Migration 016: Webhooks — table déjà créée en 006_megafeatures.sql
-- Ce fichier garantit la séquence de migrations sans erreur.
-- Ajout d'un index manquant pour les requêtes par canal.

CREATE INDEX IF NOT EXISTS webhooks_channel_id ON webhooks(channel_id);
CREATE INDEX IF NOT EXISTS webhooks_server_id  ON webhooks(server_id);
