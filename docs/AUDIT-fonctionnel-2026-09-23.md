# Audit fonctionnel ForgeChat - 2026-09-23

Audit en lecture seule. Aucune ligne de code modifiée. Chaque constat est vérifié dans le code (grep/lecture), pas dans `FEATURE_BACKLOG.md`.
Méthode : les 278 routes de `server/src/main.rs` ont été croisées automatiquement avec les 243 appels `api.*()` du client (`client/src`), puis les flux sensibles (permissions, diffusion WS, non-lus, notifications, présence, recherche, voix) ont été lus à la main.

Limites : pas d'exécution de l'app ni de la base de prod ; les appels client construits dynamiquement (hors `api.get('...')`, `postWithUploadProgress`) ont été vérifiés un par un par grep.

---

## 1. Inventaire de ce qui existe réellement

Légende : **OK** = câblé de bout en bout (UI -> API/WS -> handler -> DB) ; **PARTIEL** = une partie manque ou est trompeuse ; **MORT** = backend sans UI, ou UI sans backend.

### Messagerie serveur
| Fonction | État | Preuve |
|---|---|---|
| Salons texte, catégories, réordonnancement, archivage | OK | `main.rs:501-509`, `channels.rs` |
| Envoi / édition / suppression / historique des éditions | OK | `messages.rs:192,405,470,736` |
| Pagination de l'historique (before / around) | OK, sans N+1 (pièces jointes et réactions chargées par `ANY($1)`) | `messages.rs:19-190` |
| Réponses, transferts, épingles, réactions | OK, mais contrôles d'accès incomplets (voir P1-4, P1-5) | `messages.rs:309,788,610,534` |
| Pièces jointes, messages vocaux, GIF (Tenor), stickers, emojis perso | OK | `uploads.rs`, `GifPicker.tsx:7` |
| Sondages | OK (création ajoutée récemment) | `MessageInput.tsx:310-320`, `polls.rs` |
| Messages programmés, éphémères, rappels | OK, mais rappels perdus hors ligne (P1-8) | `scheduled.rs`, `main.rs:89-124` |
| Slowmode, AutoMod, timeouts appliqués à l'envoi | OK pour `send_message`, contournables par transfert (P1-5) | `messages.rs:226-296` |
| Traduction | OK, mais le contenu part chez un tiers (api.mymemory.translated.net) | `messages.rs:1009-1012` |
| Aperçus de liens (OG) | OK, garde anti-SSRF présent | `audit.rs:628,655` |
| Recherche dans un salon / DM / groupe | OK mais basique (P2-7) | `messages.rs:677-705`, `SearchPanel.tsx:39` |
| Recherche globale | PARTIEL : 10 résultats, pas de DM, pas de filtres | `search.rs:32-110` |

### Fils et forums
| Fonction | État | Preuve |
|---|---|---|
| Fils (threads) créés depuis un message | OK, mais table séparée `thread_messages` : texte seul, pas de non-lus, pas de mentions, pas de recherche, pas de pagination | `threads.rs:49-51,60-66,174-179` |
| Forums avec tags, tri, épingles, réponses, réactions | OK, liste limitée à 50 posts sans pagination, réponses sans LIMIT | `forum.rs:74-80,202-208` |

### DM et groupes
| Fonction | État | Preuve |
|---|---|---|
| DM 1:1 : messages, pièces jointes, réactions, épingles, recherche, accusés de lecture | OK | `main.rs:564-575,679,759-761` |
| DM chiffrés E2E | OK (routes appelées) | `main.rs:574-578` |
| Blocage, confidentialité DM | OK, vérifié à l'ouverture et à l'envoi | `friends.rs:323-353,729-732` |
| Groupes privés (group DM) | OK : messages, pièces jointes, épingles, réponses, renommage, ajout de membre | `group_dms.rs` |
| Retrait d'un membre d'un groupe | MORT : route jamais appelée | `main.rs:785` |
| Appels vocaux/vidéo en groupe privé | ABSENT : seulement 1:1 (`room_for_dm(a,b)`) | `websocket.rs:1394-1590`, `livekit.rs:104` |
| Résumé e-mail des DM non lus (24 h) | OK | `main.rs:304-360` |

### Voix / vidéo
| Fonction | État | Preuve |
|---|---|---|
| Salons vocaux via LiveKit SFU, jeton signé avec sources autorisées (micro/caméra/écran) | OK, CONNECT/SPEAK/STREAM respectés côté serveur | `livekit.rs:110-130`, `websocket.rs:840,1099-1113` |
| Limite d'utilisateurs, mot de passe de salon | OK | `websocket.rs:852-893` |
| Salons temporaires "rejoindre pour créer" | OK (création + suppression à vide) | `websocket.rs:893-910,414-443` |
| Scène (stage), main levée, réactions, tableau blanc, soundboard | OK | `websocket.rs:1191-1390,1593-1685` |
| Appels DM 1:1 avec sonnerie, appels manqués, historique | OK | `websocket.rs:1394-1590`, `friends.rs:1597` |
| Modération vocale (rendre muet/sourd, déplacer, déconnecter) | ABSENT : aucun opcode WS, bits MUTE/DEAFEN/MOVE/PRIORITY jamais lus par le serveur | liste des opcodes `websocket.rs:588-1685` |
| Enregistrement, transcription, salles de sous-groupes | ABSENT | aucun `egress`/`recording` |

### Serveurs, rôles, modération
| Fonction | État | Preuve |
|---|---|---|
| Création/édition/suppression de serveur, icône, bannière, invitations (expiration, nb d'usages) | OK | `servers.rs`, `invites.rs:28-46` |
| Rôles, permissions au niveau serveur | OK pour les actions d'admin (MANAGE_ROLES, KICK, BAN...) | `servers.rs:920-985`, `roles.rs` |
| Surcharges de permissions par salon | PARTIEL : seul VIEW_CHANNEL (et les bits vocaux) sont appliqués (P1-2) | `state.rs:553-570` |
| Expulsion | OK (menu membres, réservé au propriétaire côté UI) | `MemberList.tsx:108,152-156` |
| Bannissement | MORT côté UI : route jamais appelée, seul le débannissement existe | `main.rs:491`, `BansTab.tsx:26` |
| Timeouts (mise en sourdine temporaire) | MORT côté UI : l'effet est géré (`App.tsx:772`, bannière `ChannelPage.tsx:721`) mais aucun écran ne permet d'en créer | `main.rs:743-744` |
| Notes de modération | MORT : 3 routes sans UI | `main.rs:739-741` |
| Signalements, journal d'audit, AutoMod, porte de vérification | OK | `reports.rs`, `audit.rs`, `servers.rs:996` |
| Hiérarchie des rôles | ABSENT (P2-3) | `servers.rs:514-527`, `moderation.rs:165-205` |
| Tickets, flux RSS, webhooks, bots + commandes slash, import Discord, modèles de serveur | OK (la sauvegarde "mon serveur comme modèle" n'a pas d'UI : `main.rs:702` jamais appelé) | |

### Compte, présence, notifications
| Fonction | État | Preuve |
|---|---|---|
| Inscription avec vérification e-mail, connexion, refresh, 2FA TOTP, sessions, export RGPD, suppression de compte | OK | `main.rs:213-216,460-476` |
| Mot de passe oublié | ABSENT : lien `mailto:` vers l'admin | `LoginPage.tsx:139-143` |
| Statuts en ligne / absent / ne pas déranger / invisible | PARTIEL : le statut choisi est écrasé (P1-3) | `websocket.rs:95-118,244-249` |
| Statut personnalisé | PARTIEL : `CustomStatusModal.tsx` n'est importé nulle part et appelle `PATCH /user/settings` qui n'existe pas (seul `PUT` existe) | `CustomStatusModal.tsx:93`, `main.rs:711` |
| Carte de profil : infos membre du serveur | MORT : `GET /servers/:id/members/:uid` n'existe pas, 404 | `UserProfileCard.tsx:90` |
| Niveaux de notification par salon / serveur | PARTIEL (P1-7) | `channelNotif.ts`, `App.tsx:369-425` |
| Notifications push (onglet fermé, mobile) | ABSENT : aucun push serveur, documenté dans le code | `hooks/usePushNotifications.ts:7` |
| Groupes d'amis, notes et surnoms d'amis, alerte "ami en ligne" | MORT : 9 routes sans UI | `main.rs:635-646` |
| Notes utilisateur génériques `/notes/:id` | MORT | `main.rs:661-662` |

---

## 2. P1 - Cassé ou trompeur aujourd'hui

### P1-1. Les messages des salons privés sont diffusés à TOUS les membres du serveur
- **Quoi** : `send_message` diffuse `MESSAGE_CREATE` via `broadcast_to_server_members`, qui ne filtre que par appartenance au serveur. Idem pour édition, suppression, réactions, épingles, messages de fil et réponses de forum, création de salon et de ticket.
- **Preuve** : `messages.rs:385,465,520,568,605,639,670,904` ; `threads.rs:156,353` ; `forum.rs:179,398` ; `channels.rs:115` ; `tickets.rs:148` ; la fonction `state.rs:205-224` ne lit pas `channel_permissions`. Pourtant `broadcast_to_channel_members` (filtré, `state.rs:229-245`) existe et est déjà utilisé par `uploads.rs:176`, `polls.rs`, `webhooks.rs`.
- **Pourquoi** : n'importe quel membre ouvrant la console WS lit en direct les salons staff/privés. Le masquage n'est vrai que pour l'historique REST. C'est une fuite de données, pas seulement un défaut fonctionnel.
- **Correctif** : remplacer `broadcast_to_server_members` par `broadcast_to_channel_members(channel_id, ...)` pour tout événement porteur de contenu de salon ; pour `CHANNEL_CREATE` d'un salon privé, filtrer aussi par audience.
- **Taille** : S.

### P1-2. Les permissions de salon affichées dans l'UI ne sont pas appliquées
- **Quoi** : `SEND_MESSAGES`, `READ_HISTORY`, `ATTACH_FILES`, `EMBED_LINKS` ne sont jamais testés par le serveur (seules occurrences : valeurs par défaut `servers.rs:59-65`, `templates.rs:182-185`). `send_message` ne vérifie que l'appartenance (`messages.rs:198`), `upload_file` idem (`uploads.rs:34`). Les surcharges de salon ne servent qu'à VIEW_CHANNEL (`state.rs:560-568`) et aux bits vocaux (`websocket.rs:552-569`).
- **Pourquoi** : `ChannelSettingsModal.tsx:25-38` et `RolesTab.tsx:42-61` proposent ces cases ; un admin qui crée un salon "lecture seule" (règlement, annonces non typées) croit l'avoir protégé, alors que tout le monde peut y écrire. Le client ne bloque pas non plus la saisie.
- **Correctif** : une fonction serveur unique `channel_permissions(user, channel) -> i64` (rôles + @everyone + surcharges rôle/membre, logique déjà présente dans `apply_channel_overrides`, `state.rs:~700`) appelée par `send_message`, `upload_file`, `forum_upload`, fils, forums, réactions, transfert ; exposer le masque au client pour griser la zone de saisie.
- **Taille** : M.

### P1-3. Le statut choisi (ne pas déranger, invisible) est perdu à chaque reconnexion
- **Quoi** : une seule colonne `users.status` sert à la fois de préférence et d'état en direct. À la connexion, tout statut autre que `invisible` est remplacé par `online` (`websocket.rs:107-114`). À la déconnexion du dernier appareil, le statut devient `offline` (`websocket.rs:244-249`), donc la connexion suivante lit `offline`, pas `invisible`, et affiche l'utilisateur en ligne.
- **Pourquoi** : un utilisateur invisible redevient visible après une coupure réseau ou un redémarrage ; "ne pas déranger" disparaît au premier rechargement. En plus, l'auto-absence est calculée par onglet (`App.tsx:433-459`) : un onglet inactif passe tout le compte en "absent" alors que l'utilisateur tape sur un autre appareil.
- **Correctif** : colonne `preferred_status` (online/idle/dnd/invisible) persistée, statut en direct calculé = hors ligne si aucune session, sinon `preferred_status` ; auto-absence agrégée côté serveur (absent seulement si toutes les sessions sont inactives).
- **Taille** : S/M.

### P1-4. `reply_to` non vérifié : lecture d'un message d'un salon ou serveur inaccessible
- **Quoi** : `send_message` insère `body.reply_to` tel quel (`messages.rs:309-316`) puis renvoie et diffuse `reply_to_content` lu sans aucune vérification de salon (`messages.rs:338`). `get_messages` fait la même jointure.
- **Pourquoi** : connaissant l'identifiant d'un message (liens de message, exports, captures), on obtient son contenu. Discord refuse une réponse à un message d'un autre salon.
- **Correctif** : `WHERE m.id=$1 AND m.channel_id=$2` à l'insertion, sinon `400`.
- **Taille** : S.

### P1-5. Le transfert de message contourne toutes les règles du salon cible
- **Quoi** : `forward_message` (`messages.rs:788-850`) ne vérifie que l'appartenance au serveur de destination (`:845`). Aucun contrôle : salon masqué (destination et source), salon d'annonces, timeout, slowmode, AutoMod.
- **Pourquoi** : un membre en timeout ou visé par l'AutoMod publie quand même, y compris dans un salon d'annonces ou un salon qu'il ne voit pas ; source lisible depuis un salon masqué.
- **Correctif** : extraire les contrôles de `send_message` (lignes 198-305) dans une fonction `can_post(state, user, server, channel, content)` et l'appeler dans les deux handlers (et dans fils, forums, planifiés).
- **Taille** : S.

### P1-6. Non-lus : jamais synchronisés en lecture continue ni entre appareils
- **Quoi** :
  1. Le salon n'est marqué lu qu'à l'ouverture ou au retour du focus (`ChannelPage.tsx:133-147`). Les messages lus en direct, fenêtre active, ne mettent pas à jour `last_read` : après rechargement ou sur un autre appareil, ils réapparaissent non lus.
  2. `mark_channel_read` ne diffuse aucun événement (`reads.rs:21-53`) : lire sur le PC ne retire pas le badge sur le téléphone ou l'app de bureau.
  3. `get_unread_counts` compte aussi les salons masqués par VIEW_CHANNEL (`reads.rs:85-97` ne filtre pas `hidden_channels`) : badges fantômes impossibles à effacer, et fuite du volume d'activité des salons privés.
  4. Fils et forums n'ont aucun non-lu.
- **Correctif** : marquer lu (avec `message_id` et non `NOW()`) à chaque message reçu dans le salon actif et visible, avec anti-rebond ; émettre `READ_STATE_UPDATE` à `broadcast_to_user` ; filtrer `hidden_channels` dans la requête.
- **Taille** : M.

### P1-7. Réglages de notification partiellement ignorés
- **Quoi** : le client ne lit que `muted` et le niveau `all` (`App.tsx:376-392`). Le niveau `nothing` choisi dans `ChannelNotifModal.tsx:21` sans cocher "muet" laisse passer mentions, @everyone et réponses. Le niveau serveur (`notification_overrides_server.level`) et `muted_until` (`010_mega_features.sql:61-64`) ne sont lus nulle part (aucun `muted_until` dans `server/src` ni `client/src`) : pas de "couper 1 h", pas de "serveur en mentions seulement", pas de "ignorer @everyone".
- **Mentions** : détection côté client par regex sur `@username` (`App.tsx:383`) et côté serveur par `ILIKE '%@username%'` (`reads.rs:244-275`) : `@bob` déclenche aussi pour `@bobby`, les mentions de rôle n'existent pas (le champ `mentionable` des rôles est affiché mais inutile), et l'action "Mentionner" de la liste des membres insère le surnom de serveur (`MemberList.tsx:140`) qui ne notifie personne.
- **Correctif** : résoudre les mentions au moment de l'envoi côté serveur (`<@uuid>`, `<@&role>`), les stocker dans une table `message_mentions(message_id, user_id)`, et calculer "doit notifier" côté serveur selon niveau salon > niveau serveur > défaut, `muted_until`, DND ; le client n'affiche que ce que le serveur marque.
- **Taille** : M/L.

### P1-8. Rappels perdus si l'utilisateur est hors ligne
- **Quoi** : la boucle de rappels envoie `REMINDER` par WS puis marque `sent = TRUE` sans condition (`main.rs:106-121`). Hors ligne = rappel perdu définitivement.
- **Correctif** : ne marquer envoyé que si l'utilisateur a une session (`state.clients`), sinon le livrer à la reconnexion ; ou l'ajouter à la boîte de notifications persistée.
- **Taille** : S.

### P1-9. Écrans morts ou appels vers des routes inexistantes
- `UserProfileCard.tsx:90` : `GET /servers/:id/members/:uid` n'existe pas, date d'arrivée et rôles jamais affichés.
- `CustomStatusModal.tsx:93` : `PATCH /user/settings` n'existe pas (`main.rs:711` n'a que `PUT`), et le composant n'est monté nulle part. De plus `update_me` utilise `COALESCE($4, custom_status)` (`users.rs:155`) : impossible d'effacer un statut personnalisé via ce chemin.
- Bannir, timeout, notes de modération : backend prêt, aucune UI (voir inventaire). La liste des membres n'affiche "Expulser" qu'au propriétaire (`MemberList.tsx:108`) même si un rôle a KICK_MEMBERS.
- **Correctif** : ajouter la route manquante (ou supprimer la requête), brancher "Bannir / Timeout" dans le menu contextuel des membres, calculer `canKick/canBan` depuis le masque de permissions déjà reçu (`ChannelPage.tsx:322-331` sait le faire).
- **Taille** : S chacun.

---

## 3. P2 - Manques importants attendus par un utilisateur de Discord / TeamSpeak / Teams

### P2-1. Notifications push (Web Push + app de bureau fermée)
- Aucun push serveur (`usePushNotifications.ts:7`). Onglet fermé = aucune alerte, sauf un e-mail de DM après 24 h. Discord, Teams, Rocket.Chat poussent sur mobile et navigateur.
- **Approche** : crate `web-push` (VAPID), table `push_subscriptions`, envoi quand aucune session WS active et que la règle de notification serveur (P1-7) dit oui. Le service worker existe déjà (`main.tsx:26-34`).
- **Taille** : M.

### P2-2. Modération vocale
- MUTE_MEMBERS, DEAFEN_MEMBERS, MOVE_MEMBERS, PRIORITY_SPEAKER sont proposés dans l'UI (`RolesTab.tsx:58-61`, `ChannelSettingsModal.tsx:35-38`) mais aucun opcode ne les exploite. Pas de "déconnecter du vocal", pas de glisser-déposer d'un membre vers un autre salon, cœur de TeamSpeak.
- **Approche** : opcodes `VOICE_SERVER_MUTE/DEAFEN/MOVE/DISCONNECT` vérifiant le bit, action via l'API LiveKit `MutePublishedTrack` / `UpdateParticipant` / `RemoveParticipant` (déjà utilisée : `livekit.rs:159`), état "muet serveur" diffusé et non levable par l'utilisateur.
- **Taille** : M.

### P2-3. Hiérarchie des rôles
- `kick_member`, `ban_member`, `create_timeout` ne protègent que le propriétaire (`servers.rs:523-527`, `moderation.rs:185-204`) : un modérateur peut expulser ou bannir un administrateur. `roles.position` existe mais n'est utilisé que pour le tri (`roles.rs:21`).
- **Approche** : `highest_role_position(user)` ; refuser si cible >= acteur ; même règle pour assigner/éditer un rôle.
- **Taille** : S.

### P2-4. Appels et visio en groupe privé, réunions
- Appels uniquement 1:1. Teams/Skype/Discord permettent l'appel de groupe dans un groupe privé. Pas de réunion planifiée rejoignable par lien, pas d'invité sans compte, pas d'enregistrement.
- **Approche** : salle LiveKit `gdm-<id>` réutilisant `CallStage`, sonnerie à tous les membres ; événements de serveur (`events.rs`) avec lien de salle ; enregistrement via LiveKit Egress plus tard.
- **Taille** : M (appel de groupe), L (réunions + enregistrement).

### P2-5. Fils : modèle à part au lieu de "fil = salon"
- `thread_messages` n'a que `content` (`threads.rs:49-51`) : pas de pièces jointes, pas de réponses, pas de non-lus, pas de mentions/notifications (aucun écouteur `THREAD_MESSAGE` hors `ThreadPanel.tsx:90`), pas de recherche, messages chargés sans LIMIT (`threads.rs:174-179`), liste figée à 50 fils (`threads.rs:60-66`). Mêmes limites pour les réponses de forum (`forum.rs:202-208`).
- **Approche** : Discord traite un fil comme un salon enfant (`channels.parent_id`, type `thread`). Migrer vers ce modèle réutilise gratuitement messages, pièces jointes, non-lus, recherche et permissions.
- **Taille** : L.

### P2-6. Mot de passe oublié
- Aucun flux de réinitialisation (`LoginPage.tsx:139-143` renvoie vers un `mailto:`). L'envoi d'e-mail existe déjà (`email.rs:10`).
- **Approche** : jeton opaque haché, expiration 30 min, usage unique, rate-limit, révocation des sessions après changement.
- **Taille** : S.

### P2-7. Recherche digne de ce nom
- Globale : `LIMIT 10`, filtrage des salons masqués APRÈS le LIMIT (`search.rs:43-47,80-83`, on peut obtenir 0 résultat alors qu'il y en a), pas de DM/groupes, pas de fils/forums, pas de pagination. Par salon : `LOWER(content) LIKE` qui n'utilise pas l'index trigramme posé sur `content` (`messages.rs:699` vs `049_trgm_search_indexes.sql`), 50 résultats max. Aucun filtre `from:`, `in:`, `has:fichier`, `before:`/`after:`.
- **Approche** : colonne `tsvector` + index GIN (ou `ILIKE` sur la colonne indexée), filtrage des salons autorisés dans le `WHERE`, curseur de pagination, parseur de filtres simple.
- **Taille** : M.

### P2-8. Rendu de listes longues
- Pas de virtualisation (aucun `react-window`/`Virtuoso`) dans `MessageList.tsx` : chaque page chargée reste dans le DOM. Liste des membres chargée entière sans pagination (`servers.rs:477-486`) et re-demandée toutes les 30 s (`MemberList.tsx:94`), alors que la présence arrive déjà par WS.
- **Approche** : virtualiser `MessageList` et `MemberList` ; membres paginés, mis à jour par événements `MEMBER_JOIN/LEAVE/UPDATE`.
- **Taille** : M.

### P2-9. Mentions : polling coûteux
- `/user/mentions` est sondé toutes les 30 s par 3 composants (`NotificationBell.tsx:44`, `ChannelSidebar.tsx:262`, `ServerSidebar.tsx:135`), chaque appel faisant un `ILIKE` sur 7 jours de messages de tous les serveurs (`reads.rs:246-280`).
- **Approche** : découle de P1-7 (table `message_mentions` + événement WS `MENTION_CREATE`), plus de polling.
- **Taille** : inclus dans P1-7.

### P2-10. Retrait de membre d'un groupe privé et gestion du propriétaire
- Route présente (`main.rs:785`) sans UI.
- **Taille** : S.

---

## 4. P3 - Confort / finition

| # | Quoi | Où | Approche | Taille |
|---|---|---|---|---|
| P3-1 | Badge serveur = nombre total de messages ; Discord : point blanc pour non-lu, chiffre rouge seulement pour mentions | `unread.ts`, `reads.rs:85-97` | renvoyer `mention_count` séparé | S |
| P3-2 | Un utilisateur en timeout peut encore rejoindre le vocal et réagir | `user_timeouts` absent de `websocket.rs` et `add_reaction` | contrôle dans `VOICE_JOIN` et réactions | S |
| P3-3 | Salon temporaire : le créateur ne peut ni le renommer ni le verrouiller (TeamSpeak/Discord le permettent) | `websocket.rs:893-910` | droits implicites sur `created_by_auto` | S |
| P3-4 | Fichiers servis publiquement (`Cache-Control: public`), URL non signées | `nginx.conf:100-106`, `main.rs:237-247` | URL signées à durée limitée comme le CDN Discord | M |
| P3-5 | Traduction envoyée à un service tiers, sans avertissement, sur une app auto-hébergée | `messages.rs:1009-1012` | option admin ou LibreTranslate auto-hébergé | S |
| P3-6 | Groupes d'amis, notes/surnoms d'amis, alerte "ami en ligne", notes utilisateur, "enregistrer comme modèle" : backend sans UI | `main.rs:635-646,661-662,702` | brancher ou supprimer (code mort) | S chacun |
| P3-7 | Comptes connectés non vérifiés (simple saisie de pseudo) | `user_settings.rs:374-404` | OAuth par plateforme, ou libellé "non vérifié" | M |
| P3-8 | Pas de SSO (OIDC/LDAP), attendu par Teams/Rocket.Chat en entreprise | aucun `oauth`/`oidc` dans `server/src` | OIDC générique | L |
| P3-9 | État temps réel en mémoire d'un seul processus (`clients`, `voice_rooms`) : pas de montée en charge horizontale | `state.rs:53,97,428-456` | pub/sub Redis (Redis déjà présent) | L |
| P3-10 | Pagination par `created_at` : deux messages à la même milliseconde peuvent être sautés | `messages.rs:78-110` | curseur `(created_at, id)` | S |
| P3-11 | Mentions de rôle et `@here` limité aux connectés | `MessageInput.tsx:414,543` | avec P1-7 | M |

---

## 5. Ce qui est bien fait (à conserver)

- Voix/vidéo sur SFU LiveKit avec droits dans le jeton : CONNECT/SPEAK/STREAM appliqués côté serveur, pas seulement dans l'UI (`livekit.rs:110-130`, `websocket.rs:1099-1113`).
- Historique des messages paginé sans N+1 (`messages.rs:112-190`).
- Masquage VIEW_CHANNEL appliqué à l'historique, à la liste des salons, à la recherche et aux mentions (`servers.rs:870-888`, `channels.rs:35`).
- Protection contre l'élévation de privilège par MANAGE_ROLES (`roles.rs:80,139,248`).
- Garde anti-SSRF sur les aperçus de liens, validation d'URL sur comptes connectés.
- Resynchronisation après coupure WS (`App.tsx:485-500`).

---

## 6. Ordre de traitement conseillé

1. P1-1 (fuite WS), P1-4, P1-5 : petits, sécurité, même fichier.
2. P1-2 (permissions de salon) avec la fonction `can_post` de P1-5.
3. P1-3 (présence), P1-8 (rappels), P1-9 (écrans morts, bannir/timeout dans l'UI).
4. P1-6 + P1-7 + P2-9 ensemble : table `message_mentions`, état de lecture par `message_id`, événements WS de synchronisation.
5. P2-1 (push) qui s'appuie sur la règle de notification serveur de l'étape 4.
6. P2-3, P2-2, P2-6, puis P2-4, P2-7, P2-8, P2-5.
