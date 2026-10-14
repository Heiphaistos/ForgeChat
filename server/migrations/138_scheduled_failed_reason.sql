-- Message programmé chiffré dont l'époque est périmée à l'heure d'envoi : non envoyé, motif visible.
ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS failed_reason TEXT;
