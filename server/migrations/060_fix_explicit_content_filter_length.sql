-- explicit_content_filter était VARCHAR(20) avec un CHECK autorisant
-- 'members_without_roles' (22 caractères) -- valeur impossible à stocker
-- depuis la création de la colonne (010_mega_features.sql). Toute tentative
-- de choisir cette option dans PrivacySection.tsx échouait en 500
-- ("value too long for type character varying(20)"), jamais détecté car
-- la feature n'avait aucune consommation runtime avant cette session.
ALTER TABLE user_settings ALTER COLUMN explicit_content_filter TYPE VARCHAR(30);
