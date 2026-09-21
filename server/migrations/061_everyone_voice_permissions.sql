-- Donne au rôle @everyone de chaque serveur existant les permissions vocales
-- CONNECT_VOICE (1<<13), SPEAK_VOICE (1<<14) et STREAM (1<<40).
--
-- Ces trois bits sont vérifiés par le serveur depuis la version 3.249.0. Ils
-- n'étaient posés nulle part jusqu'ici (le @everyone créé par servers.rs ne
-- contenait que VIEW_CHANNEL|SEND_MESSAGES|READ_HISTORY|ADD_REACTIONS|ATTACH_FILES) :
-- sans cette migration, les contrôles restent volontairement inertes pour ne pas
-- éjecter du vocal tous les membres des serveurs existants.
--
-- Après application, le comportement observable est identique à avant (tout le
-- monde peut se connecter, parler et partager son écran), mais un administrateur
-- peut désormais retirer réellement ces droits par rôle ou par canal.
UPDATE roles
SET permissions = permissions | 1099511652352  -- (1<<13) | (1<<14) | (1<<40)
WHERE is_everyone = true
  AND permissions & 1099511652352 <> 1099511652352;
