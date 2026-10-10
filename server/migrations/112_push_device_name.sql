-- Modèle du téléphone envoyé à l'inscription push : jamais relu par le serveur, plus gardé.
UPDATE push_devices SET device_name = NULL WHERE device_name IS NOT NULL;
