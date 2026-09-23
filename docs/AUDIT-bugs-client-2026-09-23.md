# Audit des défauts du client web ForgeChat (2026-09-23)

Cet audit a été fait en lecture seule : aucun fichier de code n'a été modifié.

- **Périmètre :** `client/src`, croisé avec `server/src/main.rs` (routes) et `server/src/handlers/*`. Le transport vocal (`store/voice.ts`, `voiceSfu.ts`, `call.ts`) est exclu.
- **Méthode :**
  - un script a comparé les 346 appels `api.*` à URL littérale avec les 218 routes du serveur ;
  - un autre a comparé les événements WebSocket émis (`"type": "X"`) avec ceux qu'écoute le client (`on('X')`) ;
  - les clés TanStack Query définies ont été comparées à celles qui sont invalidées ;
  - le reste a été lu à la main.
- **Fiabilité :** chaque défaut a été vérifié dans le code, côté client et côté serveur. Ceux marqués **à confirmer** n'ont pas pu être tranchés par la seule lecture.

## Synthèse

| # | Sévérité | Défaut | Emplacement |
|---|---|---|---|
| 1 | CRITIQUE (sécurité) | Le contenu des canaux privés est diffusé à tout le serveur | `server/src/handlers/messages.rs:385` |
| 2 | HAUTE | Soundboard entièrement muet (`url` au lieu de `file_url`) | `components/voice/Soundboard.tsx:12,160`, `pages/VoiceVideoPage.tsx:258-270` |
| 3 | HAUTE | Kanban des tâches toujours vide : `status` n'existe pas côté serveur | `components/tasks/KanbanBoard.tsx:3,12,26` |
| 4 | HAUTE | La déconnexion ne vide pas le cache TanStack Query (fuite de données entre deux comptes) | `store/auth.ts:64-73` |
| 5 | HAUTE | CHANNEL_CREATE et CHANNEL_DELETE ignorés : pas de `server_id` dans l'événement | `App.tsx:697-702` |
| 6 | HAUTE (à confirmer) | App bureau : tous les médias `/uploads/...` pointent vers `tauri.localhost` | `components/chat/MediaContent.tsx:65-76`, avatars, emojis |
| 7 | MOYENNE | Champs impossibles à vider (`null` écrasé par `COALESCE`) | `ServerSettingsModal.tsx:158-170`, `ChannelSettingsModal.tsx:302-310`, `ProfileSection.tsx:22,73` |
| 8 | MOYENNE | « Déconnecter les autres sessions » peut révoquer SA propre session | `components/settings/SessionsSection.tsx:44,48` |
| 9 | MOYENNE | Fil d'activité : aucun champ ne correspond à ce que renvoie le serveur | `components/activity/ActivityFeedPanel.tsx:15-20,76-98` |
| 10 | MOYENNE | L'enregistreur vocal redémarre à chaque re-rendu de `MessageInput` | `components/chat/VoiceMessageRecorder.tsx:59-66` + `MessageInput.tsx:1450` |
| 11 | MOYENNE | Impossible de modifier un événement déjà commencé | `pages/ServerEventsPage.tsx:265` |
| 12 | MOYENNE | Création de canal : le sélecteur de catégorie n'apparaît jamais | `components/modals/CreateChannelModal.tsx:53,151` |
| 13 | MOYENNE | Purge : `datetime-local` sans fuseau, et `LIMIT` sans `ORDER BY` | `pages/ServerAdminPage.tsx:63,93`, `server/.../channels.rs:655-680` |
| 14 | FAIBLE | La WebSocket se reconnecte en boucle après la déconnexion | `store/ws.ts:122-129,149-155` |
| 15 | FAIBLE | Tags de forum affichés alors que l'API a échoué | `components/modals/ChannelSettingsModal.tsx:334-342` |
| 16 | FAIBLE | Caches périmés après une adhésion par invitation, une amitié acceptée ou une réponse de forum supprimée | `InvitePage.tsx:23-27`, `FriendInvitePage.tsx:41-43`, `ForumPage.tsx:334-342` |
| 17 | FAIBLE | Apparence : `['user-settings']` n'est pas invalidé après sauvegarde | `components/settings/AppearanceSection.tsx:155` |
| 18 | FAIBLE | Modèles de serveur : deux canaux `#général` | `components/modals/ServerTemplateModal.tsx:26` |
| 19 | FAIBLE | Noms absents des toasts (FRIEND_REQUEST, FRIEND_ACCEPTED, SERVER_BOOST) | `App.tsx:524,531,799` |
| 20 | FAIBLE | Bouton « Message » du popup muet en cas d'échec | `components/UserPopup.tsx:72-75` |
| 21 | FAIBLE (a11y) | 7 boutons-icônes sans `aria-label` ni `title` | voir §21 |
| 22 | INFO | Code mort contenant deux appels d'API cassés | `components/profile/*`, `modals/NicknameModal.tsx`, `modals/UserProfileModal.tsx` |

---

## Détail

### 1. CRITIQUE : un canal privé fuit vers tous les membres du serveur

- **Lieu :** `server/src/handlers/messages.rs:385`. MESSAGE_CREATE est diffusé par `broadcast_to_server_members(server_id, …)`. On retrouve le même appel aux lignes 465, 520, 568, 605, 639 et 670 (édition, suppression, réactions, épinglage) et à la ligne 904 (message transféré).
- **Pourquoi c'est une fuite :** `broadcast_to_server_members` (`state.rs:201`) ne filtre que sur `server_members`. Le correctif N14, qui respecte VIEW_CHANNEL, n'existe que dans `broadcast_to_channel_members`.
- **Côté client :**
  - `App.tsx:334-345` incrémente un compteur de non-lus pour un canal que l'utilisateur ne voit pas ;
  - `App.tsx:372-419` affiche un toast ou une notification native avec l'auteur et le texte, dès qu'il y a une mention, `@everyone` ou un canal réglé sur « tous » ;
  - le contenu complet est de toute façon lisible dans l'onglet réseau.
- **Scénario :** un salon `#staff` réservé aux modérateurs. Chaque membre connecté du serveur reçoit tous les messages de `#staff` par WebSocket.
- **Correctif :** remplacer par `broadcast_to_channel_members(channel_id, …)` dans tous les handlers de messages de salon. Le défaut est côté serveur, mais il est visible dans le client.

### 2. HAUTE : soundboard entièrement muet

- **Serveur :** `server/src/handlers/soundboard.rs:21-28`, `SoundboardEntry { file_url }`, sans `serde rename`.
- **Client :** `components/voice/Soundboard.tsx:12` (type `url: string`) puis la ligne 160 (`new Audio(sound.url)`), ainsi que `pages/VoiceVideoPage.tsx:258-270`. Le mot `file_url` n'apparaît nulle part dans `client/src`.
- **Scénario :** un clic sur un son ne joue rien, ni chez soi ni chez les autres (`new Audio(undefined)` échoue en silence).
- **Correctif :** lire `file_url` dans les deux fichiers, ou ajouter `#[serde(rename = "url")]` côté serveur.

### 3. HAUTE : Kanban des tâches toujours vide

- **Client :** `components/tasks/KanbanBoard.tsx:3,12,26` range les tâches par `status` (`todo`, `in_progress`, `review`, `done`) et le glisser-déposer envoie `PUT {status}` (lignes 215 et 246).
- **Serveur :** la table n'a que `completed: bool` (`migrations/010_mega_features.sql:164`, `handlers/moderation.rs:286,390`). `UpdateTask` ignore `status` en silence.
- **Scénario :** une tâche créée n'apparaît dans aucune colonne, puisque `status` vaut `undefined`. Un déplacement renvoie 200 mais n'enregistre rien.
- **Correctif :** soit ajouter une colonne `status` (migration + struct + réponse), soit ramener le Kanban à deux colonnes calculées depuis `completed`.

### 4. HAUTE : la déconnexion garde les données du compte précédent

- **Lieu :** `store/auth.ts:64-73` vide les stores chat, presence, unread et la WebSocket, mais n'appelle jamais `queryClient.clear()`. `useChannelNotif` n'est pas remis à zéro non plus.
- **Pourquoi c'est visible :** `staleTime: 30_000` (`main.tsx:13`) et une navigation SPA (`nav('/login')`, `SettingsPage.tsx:208`) : le cache survit.
- **Scénario :** sur un PC partagé, B se connecte dans le même onglet après A. B voit dans la barre latérale les serveurs, les MP, les amis et les mentions de A, pendant au plus 30 s ou jusqu'au refetch. Les salons que A avait mis en sourdine le restent si `useChannelNotif.fetch` échoue, puisque son `catch {}` est muet.
- **Correctif :** dans `logout`, appeler `queryClient.clear()` (l'import est déjà fait dans `usePushNotifications.ts`) et réinitialiser `useChannelNotif`.

### 5. HAUTE : les canaux créés ou supprimés n'apparaissent pas chez les autres

- **Client :** `App.tsx:697-702` exige `d.server_id` pour invalider `['server', id]`.
- **Serveur :** le champ n'est jamais envoyé au premier niveau :
  - `channels.rs:114` et `websocket.rs:928` envoient `{type, channel}` ;
  - `channels.rs:264` et `websocket.rs:450` envoient `{type, channel_id}`.
- **Scénario :** un admin crée `#annonces`. Les autres membres ne le voient qu'au prochain refetch (focus de la fenêtre ou 30 s). Même chose pour les salons vocaux temporaires, et un salon supprimé reste cliquable (404).
- **Correctif :** ajouter `"server_id": server_id` dans les 4 `json!`. Côté client, on peut aussi lire `d.channel?.server_id` en repli.

### 6. HAUTE (à confirmer) : médias cassés dans l'application bureau

- **Constat :** le serveur renvoie des URL relatives, `/uploads/…` :
  - avatars et bannières : `users.rs:299,378` ;
  - pièces jointes : `uploads.rs:138,227` ;
  - emojis : `emojis.rs:98`.
- **Pourquoi l'app bureau est touchée :** elle charge le client depuis `frontendDist` (origine `http://tauri.localhost`). Les `<img src="/uploads/x.png">` (`MediaContent.tsx:65-76`, `MemberList.tsx:58`, `DMConversation.tsx:100`, etc.) se résolvent donc vers `tauri.localhost/uploads/...`, qui n'existe pas. Seuls `api/client.ts` et `ws.ts` préfixent `SERVER_URL`. Aucune balise `<base>`, aucun protocole personnalisé et aucune réécriture n'a été trouvé dans `desktop/src-tauri`.
- **Scénario :** dans l'app bureau, avatars, images envoyées, vidéos et emojis personnalisés s'affichent cassés.
- **Correctif :** créer un utilitaire `mediaUrl(u)` qui préfixe `SERVER_URL` quand l'URL commence par `/uploads/`, et l'utiliser partout où l'on rend `src=` (ou dans un composant `<Avatar>` central).
- **À confirmer** en lançant l'app bureau.

### 7. MOYENNE : des champs impossibles à vider

Le client envoie `null`, le serveur fait `COALESCE($n, ancienne valeur)`. Le toast annonce un succès, mais la valeur ne change pas.

- **Paramètres du serveur :** `ServerSettingsModal.tsx:158-170` (options « Aucun » aux lignes 512, 523 et 533, message de bienvenue, bannière, vanity URL), contre `servers.rs:191-201`.
- **Paramètres du canal :** `ChannelSettingsModal.tsx:302-310` (sujet vidé, limite vocale remise à 0), contre `channels.rs:164-172,198-206`.
- **Bannière du profil :** `ProfileSection.tsx:73` envoie `{banner:null}`, que `users.rs:157` ignore. La bannière revient au rechargement, et l'appel n'a pas de `.catch`.
- **Anniversaire :** `ProfileSection.tsx:22` envoie `birthday:null`. Or `Option<serde_json::Value>` désérialise `null` en `None` (`models/user.rs:111`), donc la branche `Some(Value::Null)` de `users.rs:142` n'est jamais atteinte.
- **Correctif :** côté serveur, `Option<Option<T>>` avec `#[serde(default, deserialize_with = …)]` (le motif existe déjà dans `UpdateUserSettings`), plus un `CASE` explicite dans la requête SQL.

### 8. MOYENNE : révocation de la mauvaise session

- **Client :** `components/settings/SessionsSection.tsx:44,48` suppose que la session courante est `sessions[0]`.
- **Serveur :** `auth.rs:573` trie par `last_seen DESC`, et `last_seen` n'est mis à jour qu'au refresh (`auth.rs:369`). Aucun champ n'indique la session courante.
- **Scénario :** le téléphone a rafraîchi son token après le PC. Sur le PC, « Déconnecter les autres » révoque la session du PC et laisse le téléphone connecté.
- **Correctif :** le serveur renvoie `current: true` en comparant avec le refresh token ou l'identifiant de session de la requête.

### 9. MOYENNE : un fil d'activité qui n'affiche rien d'utile

- **Client :** `components/activity/ActivityFeedPanel.tsx:15-20,76-98` attend `type: message|mention|reaction`, `user`, `content`, `channel_name`.
- **Serveur :** `users.rs:934-975` renvoie `type: server_join|friend_join_server|message_pin`, `actor`, `server`.
- **Scénario :** dans la barre latérale droite, chaque ligne affiche « Utilisateur » et « #undefined », sans contenu, et les filtres Mentions et Réactions sont toujours vides.
- **Correctif :** aligner le composant sur le contrat du serveur. `ActivityFeedPage` le lit déjà correctement et peut servir de modèle.

### 10. MOYENNE : l'enregistrement vocal redémarre tout seul

- **Cause :** `VoiceMessageRecorder.tsx:59-66` lance `start()` dans un `useEffect([start, stop])`, et `start` dépend de `onCancel`. Or `MessageInput.tsx:1450` passe `onCancel={() => setShowVoiceRecorder(false)}`, une fonction recréée à chaque rendu. `MessageInput` a une vingtaine de `useState` et 5 `useQuery` : un refetch au retour du focus suffit à le re-rendre.
- **Enchaînement :** chaque re-rendu déclenche le nettoyage puis `stop()` et un nouveau `getUserMedia`. `onstop` passe l'interface en « aperçu » pendant qu'un nouvel enregistrement tourne, et le compteur repart à 0.
- **Autre fuite :** si le composant est démonté pendant le dialogue d'autorisation du micro, `streamRef` est encore `null` au moment du nettoyage, donc le micro reste ouvert.
- **Correctif :**
  - `useEffect(() => { start(); … }, [])`, avec `onCancel` lu via un ref ;
  - dans `start`, après `await getUserMedia`, couper le flux si le composant a été démonté entre-temps.

### 11. MOYENNE : modifier un événement en cours échoue

- **Client :** `ServerEventsPage.tsx:265` renvoie toujours `start_time`, pré-rempli à la ligne 510.
- **Serveur :** `events.rs:262-265` refuse toute date passée (400 « La date de début doit être dans le futur »).
- **Scénario :** corriger une faute dans la description d'un événement qui a déjà commencé est impossible.
- **Même famille :** vider la description ou la date de fin est impossible (lignes 264 et 266 : un champ vide devient `undefined`, et `events.rs:271,274` garde alors l'ancienne valeur).
- **Correctif :** n'envoyer `start_time` que s'il a changé, ou ne valider côté serveur que les dates modifiées.

### 12. MOYENNE : pas de choix de catégorie à la création d'un canal

- **Client :** `CreateChannelModal.tsx:53,151` cherche les catégories dans `channels` (`type==='category'`).
- **Serveur :** les catégories sont dans une table séparée (`GET /servers/:id/categories`), absente de `get_server` (`servers.rs:154`).
- **Scénario :** le sélecteur de catégorie n'apparaît jamais, donc le canal est toujours créé hors catégorie.
- **Correctif :** charger `['categories', serverId]` depuis la route dédiée.

### 13. MOYENNE : une purge de messages imprécise (action irréversible)

- **Date sans fuseau :** `ServerAdminPage.tsx:63,93` envoie la valeur brute d'un `datetime-local`, sans fuseau (ex. `2026-09-23T14:00`). `channels.rs:655,663` la convertit avec `$2::timestamptz`, dans le fuseau de la session Postgres. **À confirmer :** si ce fuseau est l'UTC, une purge « avant 14 h » heure de Paris supprime aussi 2 h de messages de trop.
- **Ordre non défini (confirmé) :** `LIMIT $n` sans `ORDER BY` (`channels.rs:655-680`). « Purger 100 messages » supprime donc 100 messages quelconques.
- **Correctif :**
  - client : `new Date(v).toISOString()` ;
  - serveur : `ORDER BY created_at DESC` dans une sous-requête `id IN (SELECT … LIMIT n)`.

### 14. FAIBLE : reconnexion WebSocket en boucle après la déconnexion

- **Cause :** `ws.ts:149-155`, dans `disconnect()`, annule le timer puis appelle `socket.close()`. Mais `ws.onclose` (lignes 122-129) reste branché et replanifie `connect()`. Et un `connect()` en cours (en attente de `fetchWsTicket`) ouvre la socket après la déconnexion.
- **Scénario :** sur la page de connexion, le client appelle `POST /auth/ws-ticket` en boucle (401), avec un intervalle qui monte jusqu'à 30 s. Au pire, la socket d'une session fermée se rouvre.
- **Correctif :**
  - dans `disconnect`, faire `socket.onclose = null` avant `close()` ;
  - ajouter un drapeau `_stopped` testé après l'`await` de `connect`.

### 15. FAIBLE : tags de forum affichés alors qu'ils n'existent pas

- **Création :** `ChannelSettingsModal.tsx:334-336` ajoute le tag à l'écran même dans le `.catch` (400 au-delà de 20 tags ou de 32 caractères).
- **Suppression :** lignes 341-342, le tag est retiré avant la réponse, sans retour arrière en cas d'échec.
- **Correctif :** n'ajouter le tag qu'en cas de succès, et le réinsérer si la suppression échoue.

### 16. FAIBLE : trois caches périmés

- **Adhésion par invitation :** `InvitePage.tsx:23-27` n'invalide pas `['servers']`, contrairement à `ExplorePage.tsx:35`. Le serveur rejoint peut manquer dans la barre latérale jusqu'à 30 s.
- **Amitié acceptée :** `FriendInvitePage.tsx:41-43` n'invalide pas `['friends']`, et FRIEND_ACCEPTED n'est envoyé qu'à l'inviteur (`friends.rs:627+`). Le nouvel ami manque chez celui qui accepte.
- **Réponse de forum supprimée :** `ForumPage.tsx:334-342` n'invalide que `['forum-post']`, et la liste n'écoute pas FORUM_REPLY_DELETE. Son `reply_count` reste trop élevé.
- **Correctif :** ajouter les `invalidateQueries` manquants.

### 17. FAIBLE : Apparence, anciennes valeurs affichées

`AppearanceSection.tsx:155` n'invalide pas `['user-settings']` (staleTime 60 s). Si on rouvre la section dans la minute, elle affiche les anciennes valeurs, et une nouvelle sauvegarde les réécrit.

**Correctif :** `qc.invalidateQueries({queryKey:['user-settings']})` dans `onSuccess`.

### 18. FAIBLE : deux canaux `#général`

Les 4 modèles de `ServerTemplateModal.tsx:26…` contiennent `général`, alors que `create_server` crée déjà ce canal (`servers.rs:81`).

**Correctif :** retirer `général` des modèles, ou le sauter s'il existe déjà.

### 19. FAIBLE : toasts sans nom

- FRIEND_REQUEST (`friends.rs:1878`) et FRIEND_ACCEPTED (`friends.rs:695`) n'envoient pas `from_username`, que lisent `App.tsx:524,531`. Le toast affiche « quelqu'un ».
- SERVER_BOOST n'envoie pas `username` (`App.tsx:799`).

**Correctif :** ajouter ces champs dans les `json!` du serveur.

### 20. FAIBLE : bouton « Message » muet en cas d'échec

`openDm` (`UserPopup.tsx:72-75`) n'a pas de `onError`. Si l'utilisateur est bloqué ou que les MP sont fermés, le clic ne fait rien, sans message.

**Correctif :** `onError: e => toast.error(e.response?.data?.error ?? '…')`.

### 21. FAIBLE (accessibilité) : boutons-icônes sans nom accessible

Ces boutons n'ont ni `aria-label` ni `title`, donc un lecteur d'écran les annonce seulement comme « bouton » :

- fermeture (X) : `chat/EditHistoryModal.tsx:41`, `chat/ForwardModal.tsx:114`, `modals/ServerSettingsModal.tsx:329,373` ;
- ajout (+) : `modals/ChannelSettingsModal.tsx:470` ;
- copie du jeton : `modals/ServerSettingsModal.tsx:760` ;
- afficher ou masquer le mot de passe : `settings/AccountSection.tsx:97`.

### 22. INFO : code mort contenant des appels cassés

`profile/UserProfileCard.tsx`, `profile/CustomStatusModal.tsx`, `modals/UserProfileModal.tsx` et `modals/NicknameModal.tsx` ne sont importés nulle part. Ils contiennent deux défauts qui ne seraient visibles que si l'on rebranchait ces fichiers :

- `CustomStatusModal.tsx:93` fait `PATCH /user/settings`, mais seuls GET et PUT existent (`main.rs:710-711`), donc 405. De plus, `custom_status` n'existe pas dans `UpdateUserSettings`.
- `UserProfileCard.tsx:90` fait `GET /servers/:id/members/:uid`, qui n'a pas de route, donc 404. Le bouton Téléphone (ligne 236) n'a pas de `onClick`, et `AchievementBadges.tsx:100,112` lit `RARITY_STYLES[badge.rarity]` alors que le serveur ne renvoie pas `rarity` : TypeError.

**Recommandation :** supprimer ces 4 fichiers (règle zéro code mort), ou les corriger avant de les rebrancher.

---

## Vérifié sans défaut

- **Routes :** hormis les deux du §22, tous les appels `api.*` à URL littérale trouvent une route avec la bonne méthode.
- **Événements WebSocket :** tous les événements émis par le serveur sont écoutés, et tous ceux qu'écoute le client sont émis. Les messages envoyés par le client (`SUBSCRIBE_CHANNEL`, `TYPING*`, `STAGE_*`, `WHITEBOARD_*`, `DM_CALL_*`, `HAND_RAISE`, `SOUNDBOARD_PLAY`, etc.) sont tous traités dans `websocket.rs`.
- **Sécurité :**
  - la seule injection HTML brute (`utils/markdown.tsx:279`, blocs de code) ne reçoit que la sortie échappée de hljs ;
  - les liens Markdown sont limités à `https?://` ;
  - la redirection après connexion (`LoginPage.tsx:28`) exige `/` et refuse `//` ;
  - le ticket WS est à usage unique : ce n'est pas le token de session dans l'URL ;
  - `on_new_window` est géré côté Tauri.
- **Nettoyage :** tous les `on()`, écouteurs et intervalles des composants sont nettoyés, sauf §10 et §14.
- **Débordement mobile :** les modales à largeur fixe utilisent `w-full max-w-[…]`, sauf `settings/ConnectedAccountsSection.tsx:142` (`w-96` = 384 px, qui tient à 390 px mais sans marge ; mettre `w-full max-w-sm`).
