-- Thème par défaut de la page Actualités : 10 (trois colonnes compactes) au lieu de 6. Le 6 n'a été le
-- défaut que quelques heures et la page l'enregistrait dès la première visite : un « 6 » stocké n'est donc
-- pas un choix, il passe au nouveau défaut.
UPDATE user_news_prefs SET prefs = jsonb_set(prefs, '{theme}', '10'::jsonb), updated_at = NOW()
 WHERE prefs->>'theme' = '6';
