-- Plusieurs comptes sur la même appli (lot confort) : un téléphone ou un navigateur reçoit
-- les notifications de chacun de ses comptes. Le jeton push / l'endpoint n'est plus unique
-- seul mais par compte ; l'appli dit au serveur quels comptes elle garde (les autres lignes
-- du même appareil sont effacées).
ALTER TABLE push_devices DROP CONSTRAINT IF EXISTS push_devices_token_key;
CREATE UNIQUE INDEX IF NOT EXISTS push_devices_user_token ON push_devices (user_id, token);
CREATE INDEX IF NOT EXISTS push_devices_token ON push_devices (token);

ALTER TABLE push_subscriptions DROP CONSTRAINT IF EXISTS push_subscriptions_endpoint_key;
CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_user_endpoint ON push_subscriptions (user_id, endpoint);
CREATE INDEX IF NOT EXISTS push_subscriptions_endpoint ON push_subscriptions (endpoint);
