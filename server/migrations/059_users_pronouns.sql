-- Le champ "Pronoms" de ProfileSection.tsx envoyait toujours vers PATCH /users/me,
-- mais aucune colonne pronouns n'existe sur `users` (UpdateProfileRequest ne
-- déclarait pas le champ -- serde l'ignorait silencieusement). La feature
-- n'avait donc jamais rien persisté depuis sa création.
ALTER TABLE users ADD COLUMN pronouns VARCHAR(30);
