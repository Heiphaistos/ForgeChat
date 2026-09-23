# Audit bugs serveur ForgeChat, 2026-09-23

Périmètre : `server/src` (handlers, websocket, state, middleware) et `server/migrations`. Audit en lecture seule, aucun code modifié.
Méthode : chaque constat a été vérifié en suivant le chemin de code de bout en bout. Les points marqués **(à confirmer)** dépendent du comportement du client ou des données en production.

Légende : **CRITIQUE** (fuite ou compromission sans prérequis), **HAUTE** (contournement d'autorisation ou perte fonctionnelle majeure), **MOYENNE** (bug réel au périmètre limité), **FAIBLE**.

---

## 1. Autorisations

### 1.1 CRITIQUE : le contenu des salons privés part en temps réel vers tout le serveur
- **Fichiers** : `handlers/messages.rs:385` (MESSAGE_CREATE), `:465` (MESSAGE_UPDATE), `:520` (DELETE), `:568`/`:605` (réactions), `:639`/`:670` (pins), `:904` (forward) ; `handlers/threads.rs:156, 281, 353, 413, 458, 498` ; `handlers/forum.rs:179, 325, 398, 454, 492, 539, 589` ; `handlers/scheduled.rs` (dispatch, MESSAGE_CREATE) ; `handlers/bots.rs:450`.
- **Problème** : tous ces événements passent par `broadcast_to_server_members`, qui envoie à **tous** les membres connectés du serveur. Le correctif N14 (`broadcast_to_channel_members` → `channel_audience`, qui applique VIEW_CHANNEL) n'est utilisé que par les webhooks, les uploads, le typing et le vocal. La lecture REST est bien protégée (`require_member_and_channel` → `hidden_channels`), mais le flux temps réel ne l'est pas.
- **Scénario** : un salon `#staff` refuse VIEW_CHANNEL à @everyone. Un modérateur y poste « on bannit X demain ». Chaque membre connecté reçoit `{"type":"MESSAGE_CREATE","message":{"content":"on bannit X demain",…}}` sur sa WebSocket. Il suffit d'ouvrir l'onglet réseau pour le lire. Même chose pour les éditions, les threads et les posts de forum.
- **Correctif** : remplacer `broadcast_to_server_members(server_id, …)` par `broadcast_to_channel_members(channel_id, …)` pour tous les événements rattachés à un canal. Garder la diffusion serveur pour ROLE_*, MEMBER_*, SERVER_*.

### 1.2 HAUTE : SEND_MESSAGES / ATTACH_FILES et les overrides de canal ne sont jamais appliqués à l'écriture
- **Fichiers** : `messages.rs:192-305` (send_message), `threads.rs:93` et `:286`, `forum.rs:108` et `:330`, `uploads.rs:28` (upload_file), `scheduled.rs:33`, `messages.rs:788` (forward).
- **Problème** : ces chemins ne vérifient que l'appartenance au serveur (plus le rôle MANAGE_MESSAGES pour les salons `announcement`). Aucun ne vérifie `SEND_MESSAGES` ni `ATTACH_FILES`, que ce soit au niveau serveur ou via `channel_permissions`. Les overrides ne sont appliqués qu'à VIEW_CHANNEL (`hidden_channels`) et aux permissions vocales (WS).
- **Scénario** : un serveur importé de Discord a un `#règles` en lecture seule (deny SEND_MESSAGES pour @everyone). N'importe quel membre fait `POST /servers/:s/channels/#règles/messages` et le message est accepté. Retirer SEND_MESSAGES de @everyone n'a aucun effet non plus.
- **Correctif** : dans `send_message` et dans tous les chemins d'écriture, utiliser `state.effective_channel_permissions(user, channel)` et exiger `SEND_MESSAGES` (et `ATTACH_FILES` pour l'upload). Pour éviter de bloquer les serveurs anciens, appliquer la même règle de rétrocompatibilité que `perm_is_administered`.

### 1.3 HAUTE : on peut épingler un message de n'importe quel serveur, puis le lire
- **Fichiers** : `messages.rs:610-641` (pin_message), `:646-672` (unpin_message), lecture dans `channels.rs:339-360` (get_pinned).
- **Problème** : `pin_message` ne vérifie pas que `message_id` appartient à `channel_id`. L'INSERT dans `pinned_messages(channel_id, message_id)` accepte un message étranger, et `UPDATE messages SET pinned=true WHERE id=$1` modifie n'importe quel message. `get_pinned` fait ensuite une jointure sur `pm.message_id = m.id` sans filtrer `m.channel_id`.
- **Scénario** : Mallory crée son propre serveur, dont il a donc MANAGE_MESSAGES. Il appelle `PUT /servers/SA/channels/CA/messages/<id d'un message d'un salon privé de B>/pin`, puis `GET /servers/SA/channels/CA/pins` renvoie le contenu et l'auteur du message. Avec `unpin`, il peut aussi passer `pinned=false` sur n'importe quel message de n'importe quel serveur.
- **Correctif** : ajouter `SELECT EXISTS(… messages WHERE id=$1 AND channel_id=$2)` avant d'épingler (c'est déjà fait dans `dm_extras.rs:84`), ajouter `AND channel_id=$2` aux deux UPDATE et `AND m.channel_id = pm.channel_id` dans `get_pinned`.

### 1.4 HAUTE : `reply_to` n'est pas validé, ce qui permet de lire un message arbitraire (dont les DM d'autrui)
- **Serveur** : `messages.rs:309-331` insère `body.reply_to` tel quel, puis renvoie `reply_to_content`. `get_messages` (`:46-110`) fait `LEFT JOIN messages rm ON rm.id = m.reply_to` sans contrainte de canal.
- **DM** : `friends.rs:749` (`reply_to` lu du JSON), `:806-822` (renvoie `dm.content` du message cité sans vérifier `dm_channel_id`), `:491-497` (`WHERE dm.id = ANY($1)`, sans filtre, à chaque chargement de l'historique).
- **Scénario** : Mallory envoie dans son propre DM `{"content":"x","reply_to":"<uuid d'un DM entre Alice et Bob>"}`. La réponse HTTP contient `reply_to.content` : il lit le message privé, et cette fuite persiste à chaque rechargement. Côté serveur, il peut citer un message d'un salon privé ou d'un autre serveur.
- **Prérequis** : connaître l'UUID. Il peut venir d'un ancien accès, d'un lien « aller au message » partagé, des logs ou d'un transfert.
- **Correctif** : valider `reply_to` comme le fait déjà `group_dms.rs:393-397` (`WHERE id=$1 AND dm_id=$2`) et le mettre à NULL s'il est invalide. Dans les deux SELECT de lecture, ajouter `AND rm.channel_id = m.channel_id` et `AND dm.dm_channel_id = $dm`.

### 1.5 HAUTE : `forward_message` contourne timeout, AutoMod, antispam, slowmode, salon annonce et salon privé
- **Fichier** : `messages.rs:788-905`.
- **Problème** : pour la source, seule l'appartenance au serveur est vérifiée, pas `hidden_channels`. Pour la destination, seul `require_member` est appelé. Il n'y a ni `hidden_channels`, ni `user_timeouts`, ni `check_automod`, ni `message_spam_track`, ni slowmode, ni restriction `announcement`.
- **Scénario** : un membre en timeout, ou filtré par l'AutoMod, écrit son contenu interdit dans un DM puis appelle `POST /messages/<dm_msg>/forward {"channel_id": "<#annonces>"}`. Le message est publié et diffusé. En boucle, il inonde le salon sans aucune limite de débit. Il peut aussi exfiltrer un message d'un salon privé vers un salon public.
- **Correctif** : factoriser les contrôles de `send_message` dans une fonction `ensure_can_post(state, user, server, channel, content)` et l'appeler aussi depuis forward, scheduled, threads et forum. Pour la source, appeler `require_member_and_channel`.

### 1.6 HAUTE : IDOR inter-serveurs sur le forum et les threads
- **`forum.rs:403-451` (update_post)** : le handler appelle seulement `require_member(server_id)` et `require_permission(server_id, MANAGE_MESSAGES)`. Rien ne vérifie que `channel_id` appartient à `server_id`, et l'UPDATE filtre sur `channel_id` seul. Scénario : un modérateur de *son* serveur A envoie `PATCH /servers/A/channels/<forum de B>/posts/<post de B> {"locked":true,"pinned":true}` et verrouille ou épingle les posts du serveur B.
- **`threads.rs:468-495` (delete_thread_message)** : la requête est `WHERE id=$1 AND thread_id=$2`, sans vérifier que le thread appartient à `channel_id`. Un modérateur de A peut supprimer un message de thread de B en passant ses propres `server_id`/`channel_id`. `edit_thread_message` (`:442`) a le même trou, mais il est sans effet puisque la requête est limitée à l'auteur.
- **Correctif** : dans update_post, remplacer `require_member` par `require_member_and_channel`. Dans les deux handlers de thread, ajouter `AND thread_id IN (SELECT id FROM threads WHERE channel_id=$c)`. Au passage, `delete_thread_message` ne décrémente pas `threads.message_count`.

### 1.7 HAUTE : aucune hiérarchie de rôles (kick, ban, gestion des rôles)
- **Fichiers** : `servers.rs:509-563` (kick), `:566-634` (ban), `roles.rs:125` (update_role), `:190` (delete_role), `:287-310` (remove_role).
- **Problème** : seul le propriétaire est protégé. Toute personne ayant KICK_MEMBERS ou BAN_MEMBERS peut expulser ou bannir un administrateur. Toute personne ayant MANAGE_ROLES peut retirer le rôle Admin à ses titulaires, le supprimer, ou lui retirer des permissions (le commentaire de `update_role` l'assume : « un rôle peut être rétréci librement »). `roles.position` existe mais n'est jamais comparé.
- **Scénario** : un modérateur junior (KICK_MEMBERS seul) bannit tous les administrateurs sauf le propriétaire. Un détenteur de MANAGE_ROLES supprime le rôle Admin.
- **Correctif** : calculer `max(position)` des rôles de l'acteur et de la cible, et refuser si la cible est au même niveau ou au-dessus (sauf pour le propriétaire). Même contrôle sur le rôle visé dans update, delete, assign et remove.

### 1.8 MOYENNE : la WebSocket accepte un JWT révoqué, et le changement de mot de passe ne coupe pas les autres appareils
- **Fichiers** : `websocket.rs:57-63` appelle `verify_token` sans consulter `jwtblock:` (contrairement à `middleware/auth.rs:88-97`) ; `auth.rs:458-470` (change_password met en blocklist le seul token courant).
- **Scénario** : après un logout ou un changement de mot de passe suite à un vol de token, le token volé ouvre encore `/ws?token=…` pendant 24 h. L'attaquant reçoit alors tous les DM (`DM_MESSAGE`), la présence et les appels. Le jeton d'accès d'un autre appareil reste lui aussi valide 24 h sur l'API REST.
- **Correctif** : dans `handle_socket`, vérifier `jwtblock:<hash>`. Ajouter un `token_version` en base, inclus dans les claims et vérifié par le middleware et la WS, et l'incrémenter au changement de mot de passe et au « déconnecter partout ».

### 1.9 MOYENNE : les tickets sont diffusés à tout le serveur
- **Fichiers** : `tickets.rs:147-148` (TICKET_CREATE avec l'objet complet), `:229-230` (TICKET_UPDATE), `:276`.
- **Problème** : `list_tickets` (`:77-90`) limite la lecture à ses propres tickets, sauf pour MANAGE_SERVER, mais les événements WS envoient le ticket complet (titre, créateur, assigné) à tous les membres.
- **Correctif** : envoyer au créateur (`broadcast_to_user`), aux membres ayant MANAGE_SERVER et à l'assigné.

### 1.10 MOYENNE : les timeouts ne sont pas appliqués sur plusieurs chemins d'écriture
- Chemins où le timeout est vérifié : `send_message`, `send_thread_message`, `create_post`, `reply_to_post`, polls, events, tickets, scheduled.
- Chemins **non** vérifiés : `edit_message` (`messages.rs:405`), `add_reaction` (`:534`), `forward_message` (§1.5), `create_thread` (`threads.rs:93`), `upload_file` (`uploads.rs:28`, qui ajoute des pièces jointes à un ancien message), `VOICE_JOIN` (`websocket.rs:802`, où un membre en timeout parle en vocal).
- **Correctif** : faire vérifier le timeout par un seul helper, appelé depuis la fonction `ensure_can_post` du §1.5, et l'appeler aussi dans VOICE_JOIN.

### 1.11 MOYENNE : kick, ban et départ laissent l'accès vocal et les rôles en place
- **Fichiers** : `servers.rs:531-537` (kick), `:600-606` (ban), `:448-453` (leave).
- **Problème 1** : `member_roles` n'est pas purgé. Un modérateur expulsé qui revient par une invitation publique retrouve tous ses rôles, et donc ses permissions.
- **Problème 2** : le membre expulsé ou banni n'est pas retiré du vocal (`cleanup_voice` et `livekit::remove_participant` ne sont pas appelés). Il continue de parler et d'être entendu dans la room LiveKit du serveur jusqu'à ce qu'il raccroche.
- **Correctif** : `DELETE FROM member_roles WHERE user_id=$1 AND server_id=$2`, et si `user_voice[user]` est un canal de ce serveur, appeler `cleanup_voice(state, user, None)`.

### 1.12 FAIBLE : la porte de vérification n'est pas appliquée côté serveur
- `servers.rs:1002-1031` renseigne `verified_at`, mais aucun chemin d'écriture ne le contrôle (grep : lu seulement dans `get_server`). Un client modifié poste sans avoir validé. **(à confirmer : dépend de l'intention produit)**

---

## 2. Correction fonctionnelle et intégrité des données

### 2.1 HAUTE : suppression de compte impossible (500) pour quiconque a posté
- **Fichiers** : `users.rs:470` (`DELETE FROM users`) ; FK sans `ON DELETE` : `001_initial.sql:115` (`messages.user_id`), `:154` (`pinned_messages.pinned_by`), `:172` (`dm_messages.sender_id`), `:184` (`invites.creator_id`), `002_threads_forum.sql:9, 23, 37, 52` (threads, thread_messages, forum_posts, forum_replies), `024_tickets.sql:14, 18`. Aucune migration ultérieure ne corrige ces contraintes (`grep DROP CONSTRAINT`).
- **Scénario** : un utilisateur qui a envoyé ne serait-ce qu'un message confirme la suppression avec son mot de passe. Postgres renvoie 23503 et l'utilisateur voit « Erreur base de données ». Le droit à l'effacement est donc inopérant, et le compteur `delacc_attempts` est quand même incrémenté.
- **Correctif** : ajouter une migration `ON DELETE SET NULL` (colonnes rendues nullables, puis affichage « Utilisateur supprimé ») ou réattribuer à un utilisateur fantôme `deleted-user`. `ON DELETE CASCADE` est à éviter sur `messages`, car la suppression d'un compte effacerait alors les conversations des autres.

### 2.2 MOYENNE : l'édition d'un rôle efface ADMINISTRATOR, PRIORITY_SPEAKER et STREAM
- **Fichiers** : `roles.rs:77` et `:132`, `const VALID_PERMS: i64 = 0x3FFFF` (bits 0-17).
- **Problème** : ADMINISTRATOR (bit 31), PRIORITY_SPEAKER (18) et STREAM (40) sont hors masque. Le client renvoie le masque complet à chaque modification (renommage, couleur), et le serveur réécrit `permissions` sans ces bits.
- **Scénario** : sur un serveur importé de Discord, le propriétaire renomme le rôle « Admin » et ses titulaires perdent ADMINISTRATOR. Il modifie @everyone, qui porte STREAM par défaut (`servers.rs:59-66`) : STREAM disparaît, et comme d'autres rôles importés l'ont encore (le bit reste donc « administré »), le partage d'écran est refusé à tous.
- **Correctif** : dériver le masque de `Permissions` (OR de toutes les constantes) au lieu de `0x3FFFF`. Si ces bits doivent rester non attribuables via l'API, conserver les bits hors masque déjà présents : `p = (p & VALID) | (old & !VALID)`.

### 2.3 MOYENNE : `VOICE_JOIN` direct vers un autre salon laisse un fantôme
- **Fichier** : `state.rs:428-440` (voice_join, retrait silencieux de l'ancienne room).
- **Problème** : lors d'un changement de salon sans VOICE_LEAVE préalable, l'utilisateur est retiré de `voice_rooms[old]`. Mais il n'y a pas de `VOICE_USER_LEFT` pour l'ancien salon, pas de `remove_participant` LiveKit, pas de `STREAM_END`, pas de nettoyage de `voice_states` ni des mains levées, et pas de suppression du canal temporaire vide.
- **Scénario** : un utilisateur seul dans un canal auto-créé clique directement sur un autre salon. Le canal temporaire n'est jamais supprimé (le `ponytail:` de `websocket.rs:407` suppose un leave) et les autres membres le voient encore dans l'ancien salon. **(à confirmer : dépend du fait que le client envoie VOICE_LEAVE ou non)**
- **Correctif** : au début de VOICE_JOIN, si `user_voice[user]` est un autre canal, appeler `cleanup_voice(state, user, None)`.

### 2.4 MOYENNE : course entre connexion et déconnexion WS, un onglet ne reçoit plus rien
- **Fichiers** : `websocket.rs:80-89` (l'entrée `clients` puis `conn_counts` sont mises à jour sous deux verrous distincts) et `:238-247` (décrément puis `clients.remove`).
- **Scénario** : pendant un rechargement, la socket B se ferme pendant que la socket A s'ouvre. A récupère le `tx` existant, B décrémente `conn_counts` jusqu'à 0 avant l'incrément de A et retire `clients[user]`. A reste abonnée à un `tx` hors de la map : plus aucun événement ne lui parvient, et pourtant `conn_counts` vaut 1.
- **Correctif** : protéger `clients` et `conn_counts` par un seul `RwLock<HashMap<Uuid,(Sender,usize)>>`, ou prendre les deux verrous dans le même ordre pendant toute l'opération.

### 2.5 MOYENNE : compteurs de non-lus (fuite et coût)
- **Fichier** : `reads.rs` (get_unread_counts, requête serveur).
- **Problème 1** : pas de filtre `hidden_channels`. L'endpoint renvoie les `channel_id` et le nombre de messages non lus des salons privés.
- **Problème 2** : les messages expirés (`expires_at`) sont comptés.
- **Problème 3** : chaque appel agrège 30 jours de messages sur tous les serveurs de l'utilisateur. C'est un chemin chaud (au démarrage et au retour de focus) et c'est coûteux sur un serveur importé.
- **Correctif** : filtrer avec `hidden_channels(user, None, None)`, ajouter `AND (m.expires_at IS NULL OR m.expires_at > NOW())`, et à terme passer à un compteur incrémental ou à `last_message_id` comparé à `last_read`.

### 2.6 FAIBLE : l'audience des canaux diverge de `hidden_channels`
- `state.rs:256-322` (`channel_audience`) exige VIEW_CHANNEL dans la base (rôles et @everyone) dès qu'un override existe, alors que `hidden_channels` (`state.rs:621`) ajoute `| view` à la base « parce que des serveurs existants ont un @everyone sans ce bit ». Sur ces serveurs, dès qu'un override existe, les membres voient le salon en REST mais ne reçoivent ni typing, ni messages webhook, ni `MESSAGE_ATTACHMENT_ADDED`, ni événements vocaux. **(à confirmer : existence de tels serveurs en prod)**
- **Correctif** : ajouter la même base `| VIEW_CHANNEL` dans `channel_audience`.

### 2.7 FAIBLE : messages éphémères et suppressions en cascade sans nettoyage
- `main.rs:140-150` supprime les messages expirés sans broadcast `MESSAGE_DELETE`, et la cascade sur `attachments` supprime les lignes sans supprimer les fichiers du disque. Même fuite disque lors de la suppression d'un canal ou d'un serveur (fichiers orphelins dans `upload_dir`).

### 2.8 FAIBLE : pagination sur `created_at` strict
- `messages.rs:87-99` (`m.created_at < $ts`) et `friends.rs:431-441` : des messages ayant exactement le même `created_at` qu'un curseur sont sautés. C'est plausible après un import Discord en masse avec des horodatages identiques. **(à confirmer)** Correctif : curseur composite `(created_at, id) < ($ts, $id)`.

---

## 3. Robustesse

### 3.1 MOYENNE : panics et valeurs incohérentes sur des entrées utilisateur
- `messages.rs:306` : `Utc::now() + chrono::Duration::seconds(s)` avec `expires_at_seconds: i64` libre. `Duration::seconds` panique hors de ±i64::MAX/1000, et `DateTime + TimeDelta` panique en cas de dépassement.
- `servers.rs:591` (ban, `duration_hours`) et `uploads.rs:140` (`ttl_hours`) : même problème avec `Duration::hours`.
- Une valeur négative est acceptée : message immédiatement supprimé par le job, ban déjà expiré, pièce jointe expirée à l'envoi.
- `messages.rs:27` : `limit` négatif donne `LIMIT -1` et une erreur Postgres (500). `friends.rs:395` fait bien `.max(1)`.
- Pas de `CatchPanicLayer` : la connexion est coupée sans réponse. Le processus survit (`panic` n'est pas en `abort`).
- **Correctif** : borner les valeurs (`clamp(1, 7*86400)` pour les secondes, `1..=8760` heures) et utiliser `checked_add_signed`.

### 3.2 MOYENNE : `SUBSCRIBE_CHANNEL` provoque une fuite de tâches et de mémoire (code mort)
- **Fichier** : `websocket.rs:626-642`.
- **Problème** : chaque `SUBSCRIBE_CHANNEL` lance une tâche `rx.recv()` qui ne se termine jamais, car le `Sender` reste dans `channel_subs` et `user_tx.send` n'échoue pas tant que l'utilisateur a une entrée. Or rien ne publie sur `channel_subs` (grep : aucun appelant hors de cette branche). Chaque changement de salon ajoute une tâche permanente, jusqu'au redémarrage. Le handler ne vérifie pas non plus `hidden_channels`.
- **Correctif** : supprimer la branche, `channel_subs` et `get_or_create_channel_tx`.

### 3.3 MOYENNE : index manquants sur les FK référençantes, et DELETE en O(n)
- Postgres n'indexe pas automatiquement les colonnes qui référencent une autre table. Colonnes non indexées : `messages.reply_to` (`001:118`), `threads.parent_message_id` (`002:7`), `pinned_messages(message_id)` (PK `(channel_id, message_id)`), `dm_messages.reply_to_id` (`038:2`), `attachments.dm_message_id` (`038:5`), `attachments.group_dm_message_id` (`046:1`), `group_dm_messages.reply_to` (`050:3`), `message_reports.message_id` (`029:4`).
- **Conséquence** : chaque `DELETE FROM messages` déclenche un parcours séquentiel complet de `messages` pour `reply_to`, et chaque suppression de DM parcourt tout `attachments`. La suppression d'un canal ou d'un serveur importé (cascade sur N messages) devient quadratique, de même que le job des messages éphémères.
- **Correctif** : une migration avec `CREATE INDEX CONCURRENTLY` sur chacune de ces colonnes, en partiel `WHERE col IS NOT NULL` pour les colonnes nullables.

### 3.4 MOYENNE : messages programmés sans plafond
- `scheduled.rs:33-88` : aucune limite par utilisateur ni par canal, et pas de contrôle `announcement`. Un membre programme 5 000 messages pour la même minute, et le dispatcher (100 par tick, `:137`) les publie en contournant l'antispam de 5 messages par 3 s et le slowmode.
- **Correctif** : plafond (par exemple 25 en attente par utilisateur) et contrôles d'écriture communs (§1.5).

### 3.5 FAIBLE : amplification WS
- `WHITEBOARD_DRAW` (`websocket.rs:1363-1391`) relaie `points` sans validation, jusqu'à 64 Ko par message et 300 messages par 10 s, à toute l'audience du canal, sur n'importe quel type de canal. Cela représente environ 2 Mo/s sortants par attaquant et par destinataire. Il faut borner la taille de `points` et restreindre ce message aux canaux vocaux.
- `STAGE_HAND_RAISE` (`:1233`) n'a pas de rate limit et n'est pas restreint au type de canal.

### 3.6 FAIBLE : divers
- `websocket.rs:212-226` : quand `recv_task` s'arrête (message de plus de 64 Ko), `send_task` n'est pas annulée. Pour un onglet qui n'est pas le dernier, la socket reste à moitié ouverte et continue de recevoir.
- `group_dms.rs:849-863` : le contrôle « 10 membres maximum » suivi de l'INSERT n'est pas atomique, donc des requêtes concurrentes peuvent dépasser 10. On peut aussi ajouter un utilisateur quelconque (non ami) à un groupe **(à confirmer : intention produit)**.
- `DM_CALL_ACCEPT` (`websocket.rs:1488`) délivre un jeton LiveKit sans vérifier qu'un appel est en sonnerie. L'effet est limité, puisque la room est propre à la paire.

---

## Priorités de correction proposées
1. §1.1 (diffusion des salons privés) : un rechercher-remplacer ciblé, fuite active en prod.
2. §1.3, §1.4, §1.5, §1.6 : IDOR et contournements, ajouter les contrôles `channel_id` manquants et une fonction `ensure_can_post` commune.
3. §2.1 : migration des FK `users` (droit à l'effacement).
4. §1.2, §1.7 : permissions d'écriture par canal et hiérarchie de rôles (décision produit sur la rétrocompatibilité).
5. Le reste par lot : index (§3.3), bornes d'entrée (§3.1), code mort WS (§3.2).
