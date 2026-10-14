# Audit complet ForgeChat - 2026-10-13

Audit serveur, client web, mobile et bureau, suivi des corrections faites dans la même session et des
fonctions de personnalisation et « type Discord » ajoutées. Ce document fait suite à
`docs/AUDIT-fonctionnel-2026-09-23.md` et `docs/AMELIORATIONS-2026-10-12.md`.

---

## 1. Résumé

### Périmètre
| Partie | Dossier | Contenu audité |
|---|---|---|
| Serveur | `server/` (Rust, axum, Postgres) | handlers, WebSocket, état voix, uploads, validation, droits |
| Client web | `client/` (React, TypeScript) | profil, popups, réglages, a11y, i18n, stores, WS |
| Mobile | `mobile/` (React Native, Expo) | réglages profil, i18n, E2E, parité avec le web |
| Bureau | `desktop/src-tauri/` (Tauri) | commandes IPC, shell, mises à jour, voix/vidéo native, CSP |

### Méthode
- Lecture du code à la main, chaque constat est rattaché à un fichier et une ligne (`fichier:ligne`) au
  moment de l'audit ; les numéros de ligne peuvent avoir bougé après correction.
- Les constats ont ensuite été corrigés dans la même session ; la colonne « Statut » reflète l'état après
  corrections, tel que relevé dans le suivi de session.
- Les nouveautés (anneau v2, carte de profil, fonctions de catégorie, non-lu, etc.) ont été spécifiées par
  un contrat partagé serveur / web / mobile avant d'être codées, pour garder les trois côtés alignés.
- Aucune base Postgres ni appareil réel n'était disponible : voir la section 6.

### Chiffres clés
| Indicateur | Valeur |
|---|---|
| Constats serveur | 24 (S1-S24), dont 1 haute, 6 moyennes |
| Constats client | 20 (C1-C20) + 4 suites bureau (X1-X4) + 3 suites serveur (Y1-Y3) |
| Constats mobile | 14 (M1-M14) + 8 écarts de parité |
| Constats bureau | 9 (D1-D9) |
| Corrigés (au 2026-10-14) | S : 22 / 24 · C : 17 / 20 · M : 14 / 14 · D : 8 / 9 · X : 4 / 4 |
| Partiels (au 2026-10-14) | S10, S22, C17, C18, C20 |
| Non corrigés / documentés | D7 (documenté) |
| Migrations ajoutées | 136 (anneau global, carte de profil), 137 (fonctions type Discord) |
| Thèmes | 1440 -> 1580 |
| Styles d'anneau | 14 -> 34 |
| Décorations / effets | 171 -> 215 / 110 -> 143 |
| Clippy serveur | 39 erreurs préexistantes -> 0 |
| Bugs trouvés en route | permissions tronquées à 32 bits (client), `nv_popout` acceptant `ws://127.0.0.1:80@evil.example` (bureau), interblocage latent `persist_voice_to_redis` (serveur), `health.rs` `statvfs` non compilable sous Windows |

---

## 2. Personnalisation livrée

### 2.1 Thèmes
- `themeCore.ts` (952 lignes, au-delà de la limite de 800) découpé en 6 fichiers : `themeCore`,
  `themeModel`, `themeBase`, `themeClassic`, `themeCurated`, `themeFamilies`. Les copies mobile sont
  identiques à l'octet ; un test de parité compare les 6 fichiers.
- `@ts-ignore` (TS5097) retirés côté mobile grâce à `allowImportingTsExtensions` dans `mobile/tsconfig.json`.
- Contraste AA vérifié sur tous les thèmes. Les anciens identifiants ne changent pas (échantillon de 40 testé).

| Famille | Avant | Après |
|---|---|---|
| base | 4 | 48 (dont 19 clairs, ids `b-*`) |
| gradient | 126 | 138 |
| classic | 190 | 204 |
| pastel | 96 | 108 |
| neon | 96 | 107 |
| retro | 144 | 156 |
| glass | 96 | 108 |
| nature | 32 | 43 |
| seasonal | 32 | 44 |
| **Total catalogue** | **1440** | **1580** |

### 2.2 Anneau d'avatar v2
Code : serveur `server/src/models/avatar_ring.rs` (extrait de `profile_style.rs`, qui ré-exporte), web
`client/src/lib/avatarRing.ts` + `ringStyles.css`, mobile `components/avatarRingCore.ts`.

- Un anneau **global** (`users.avatar_ring`) s'ajoute à l'anneau par serveur
  (`server_members.server_avatar_ring`). Anneau affiché = anneau du serveur s'il existe, sinon anneau global.
- Affiché sur le web dans la liste des membres, les messages, le popup et la page profil ; sur mobile dans la
  liste des membres, les messages et la fiche.
- Rétro-compatible : tout anneau v1 stocké (3 couleurs au plus, épaisseur 8 au plus, 14 styles) reste valide.

Contrat (JSON, `deny_unknown_fields`, valeurs par défaut non sérialisées, taille max 512 octets) :

| Champ | Bornes / valeurs | Défaut |
|---|---|---|
| `colors` | entiers `0..=0xFFFFFF`, 1 à 8 (`RING_COLORS_MAX`) ; 0 couleur = pas d'anneau | requis |
| `width` | 1 à 12 (`RING_WIDTH_MAX`) | 3 |
| `style` | 34 valeurs (`RING_STYLES`, les 14 premiers = existants) ; `""` = `solid` | `solid` |
| `fill` | `conic`, `linear`, `radial` | `conic` |
| `angle` | 0 à 360 degrés | 0 |
| `shape` | `circle`, `rounded`, `squircle` | `circle` |
| `gap` | 0 à 8 px (`RING_GAP_MAX`) | absent = auto |
| `segments` | 2 à 24 | 12 |
| `speed` | 25 à 400 % | 100 |
| `direction` | `cw`, `ccw` | `cw` |
| `brightness` | 50 à 200 | 100 |
| `glow` | 0 à 300 | 100 |
| `opacity` | 20 à 100 | 100 |
| `intensity` | 25 à 200 (amplitude de l'animation) | 100 |

Nouveaux styles (20) : `orbit`, `double_orbit`, `aurora`, `fire`, `electric`, `wave`, `heartbeat`,
`sparkle`, `radar`, `prism`, `chase`, `ripple`, `glitch`, `twin_comet`, `stripes`, `flicker`, `halo`,
`sunburst`, `vortex`, `matrix`. Tous animés sauf `stripes` et `halo`. Les constantes Rust
(`RING_STYLES`, `RING_FILLS`, `RING_SHAPES`, `RING_COLORS_MAX`, `RING_WIDTH_MAX`, `RING_GAP_MAX`,
`RING_SEGMENTS_RANGE`, `INTENSITY_RANGE`, `RING_MAX_BYTES`) sont lues par les tests de parité web et mobile.

### 2.3 Carte de profil
`users.profile_card` (JSONB), constantes dans `server/src/models/profile_card.rs`. Tout par défaut = `NULL`.

| Champ | Valeurs | Défaut |
|---|---|---|
| `layout` | `classic`, `centered`, `compact`, `wide` | `classic` |
| `card` | `solid`, `gradient`, `glass`, `outline`, `neon` (utilise `profile_color_primary/accent`) | `solid` |
| `pattern` | `none`, `dots`, `grid`, `lines`, `diagonal`, `checker`, `waves` (même liste que les thèmes) | `none` |
| `banner_y` | 0 à 100 (% point focal vertical) | 50 |
| `banner_fx` | `none`, `blur`, `dim`, `fade`, `duotone` | `none` |
| `radius` | 0 à 24 px (`CARD_RADIUS_MAX`) | 12 |
| `angle` | 0 à 360 (dégradé de carte) | 180 |
| `show_badges` / `show_links` | booléens | `true` |
| `name_align` | `left`, `center` | `left` |

Taille max 512 octets (`PROFILE_CARD_MAX_BYTES`). Éditeur et aperçu en direct sur le web ; éditeur et rendu sur mobile.

### 2.4 API et migration 136
- Le PATCH du profil (`server/src/handlers/users.rs`, même handler que `profile_color_primary` et
  `avatar_decoration_opts`) accepte `avatar_ring` et `profile_card` : absent = inchangé, `null` = effacer,
  objet = validé strictement (400 avec message en français sinon).
- Le JSON public de l'utilisateur (profil, `/users/me`, partout où `profile_color_*` est renvoyé) expose
  `avatar_ring` et `profile_card`.
- `136_profile_ring_card.sql` : ajoute `users.avatar_ring` et `users.profile_card` (JSONB, CHECK « objet »
  et `octet_length <= 512`, `NOT VALID`, idempotent `IF NOT EXISTS`) ; la contrainte
  `server_members_ring_size` est relâchée à 512 octets (`DROP CONSTRAINT IF EXISTS` puis `ADD ... NOT VALID`).

### 2.5 Décorations et effets
| Catalogue | Avant | Après | Ajouts |
|---|---|---|---|
| Décorations | 171 | 215 | +44 en 4 catégories : `mythic`, `cute`, `tech`, `elements2` |
| Effets de profil | 110 | 143 | +33 en 4 catégories : `creatures`, `food`, `symbols`, `lights` |

Listes identiques serveur / web / mobile, ajouts en fin de liste uniquement (les index existants ne bougent pas).

### 2.6 Éditeurs de profil
| Côté | Changement |
|---|---|
| Web | Une seule barre « modifications non enregistrées » (un seul PATCH) et garde de sortie (C15) ; retrait de l'avatar (C4) ; aperçu complet |
| Mobile | PATCH des seuls champs modifiés (M1) ; sélecteur de couleur libre ; éditeur de style d'étiquette ; style de pseudo par serveur ; vitesse, angle et 2e couleur de contour ; anneau par serveur éditable ; retrait de la bannière |

---

## 3. Constats par domaine

Légende des statuts : **Corrigé** = fait et compilé/testé hors base ; **Partiel** = une partie reste ;
**Non corrigé** = rien n'a été fait ; **Documenté** = choix laissé tel quel et noté ; **À vérifier** =
le suivi de session ne dit rien sur ce point.

Gravités : Haute, Moyenne, Basse, Info, Test (qualité des tests).

### 3.1 Serveur (S1-S24)
| Id | Gravité | Emplacement | Constat | Statut | Note |
|---|---|---|---|---|---|
| S1 | Haute | `group_dms.rs:22-80`, `:875-905` | Création de groupe MP et ajout de membre ignorent `dm_from_all` et l'amitié ; blocage vérifié dans un seul sens ; pas de limite de débit ; plafond de 10 membres non atomique ; `blocked.unwrap_or(false)` laisse passer en cas d'erreur ; utilisateur inexistant -> 500 | Corrigé | `dm_guard.rs` `ensure_can_dm` partagé, blocage dans les 2 sens, 404, transaction + `FOR UPDATE`, limite de débit |
| S2 | Moyenne | `messages.rs:789`, `search.rs`, `channels.rs` ~434, fils/forum, `get_message_edits`, transfert | READ_HISTORY contournable par la recherche, les épingles, les fils, l'historique d'édition et la source d'un transfert | Corrigé | passage par `can_read_history` (`servers.rs:1070`) |
| S3 | Moyenne | `messages.rs:916-1087` | `forward_message` sans limite de débit, antispam ni slowmode | Corrigé | bloc de contrôles de `send_message` factorisé |
| S4 | Moyenne | `threads.rs:654`, `forum.rs:632` | Édition de message de fil / réponse de forum sans AutoMod ni timeout | Corrigé | |
| S5 | Moyenne | `state.rs:456-472` | `voice_join` écrit `user_voice` avant le contrôle de limite -> utilisateur fantôme | Corrigé | interblocage latent dans `persist_voice_to_redis` corrigé au passage |
| S6 | Moyenne | `uploads.rs:420`, `:462` | `remove_upload_files` ignore les chemins avec `/` (avatars et bannières jamais effacés, RGPD) ; `remove_unreferenced` ignore `server_avatar`/`server_banner` | Corrigé (lecture seule) | 2026-10-14 : sous-commande `forgechat sweep-orphan-uploads` (`handlers/upload_sweep.rs`) : parcourt toutes les colonnes texte/json/tableaux via `information_schema`, ignore les fichiers de moins de 24 h, ne suit pas les liens symboliques, sortie TSV `<octets>\t<chemin>` ; pas d'option d'effacement tant qu'une première liste n'a pas été relue en production ; requête jamais exécutée sur une vraie base. Aussi : fichier effacé si l'insertion `attachments` échoue ou si le flush échoue. `remove_unreferenced` ignore encore 7 colonnes (`forum_posts.media_url`, `roles.icon`, `servers.banner_url`, `users.banner_url`, `bg_image_url`, `user_sounds.file_url`, avatars de webhook) |
| S7 | Moyenne | `users.rs:32`, `:510` | `get_user` et `get_user_profile` exposent `status`/`custom_status` à tous (alors que `search_users` les masque) | Corrigé | |
| S8 | Basse | `member_profile.rs:92`, `:117` | PATCH du profil de membre sans limite de débit (amplification de diffusion) ; ancienne image non supprimée | Corrigé | |
| S9 | Basse | `USER_UPDATE` | Événement envoyé à soi via `UserPublic::from` au lieu de `into_self_public()` | Corrigé | |
| S10 | Basse | `users.rs:96-106` | Longueur du pseudo comptée en octets ; homoglyphes | Partiel | pseudos limités aux caractères latins (choix produit à valider) ; anciens pseudos non revérifiés ; sosies latins (`rn`/`m`) non détectés |
| S11 | Basse | `messages.rs:1094` | `set_reminder` : `remind_at` non borné, pas de plafond | Corrigé | |
| S12 | Basse | `messages.rs:712` | `pin_message` sans plafond de 50 | Corrigé | |
| S13 | Basse | `channels.rs` ~337 | Nom de catégorie non validé (vide ou > 100 -> 500) | Corrigé | |
| S14 | Basse | `channels.rs` create/update | slowmode, sujet, mot de passe vocal non bornés | Corrigé | |
| S15 | Basse | `channels.rs` update | `update_channel` ignore les surcharges et la visibilité | Corrigé | |
| S16 | Basse | `join_server` | Adhésion non transactionnelle | Corrigé | |
| S17 | Basse | envoi de message | slowmode sans exemption du staff, appliqué avant AutoMod | Corrigé | |
| S18 | Basse | `search_messages` | Messages expirés (`expires_at`) non filtrés | Corrigé | |
| S19 | Basse | `threads.rs:382`, `forum.rs:367` | Réactions sans contrôle ADD_REACTIONS | Corrigé | |
| S20 | Basse | `websocket.rs:1356` | `STAGE_HAND_RAISE` sans limite de débit ni contrôle du type de salon | Corrigé | |
| S21 | Basse | `websocket.rs:45` | `WS_MAX_PER_USER` : contrôle et incrément non atomiques | Corrigé | |
| S22 | Basse | `get_members` | Liste des membres non paginée | Partiel | pagination 1000 par page côté serveur ; client et mobile paginent (Y1) |
| S23 | Basse | `delete_account` | Le message ne mentionne pas le transfert de propriété | Corrigé | |
| S24 | Basse | `client/src/store/ws.ts` | Le client envoie `SUBSCRIBE_CHANNEL`, supprimé côté serveur | Corrigé | corrigé côté client |

Manques fonctionnels serveur relevés pendant l'audit : renommer/réordonner les catégories et synchroniser
leurs permissions, demandes de message, suivi des invitations, statut de salon vocal, bannissement en masse,
réaction par défaut et tags de modération en forum, plafonds épingles/rappels. La plupart sont livrés
(section 4) ; restent les demandes de message et le bannissement en masse.

Qualité serveur : clippy passe de 39 erreurs préexistantes à 0. `cargo fmt` signale environ 2461 blocs
préexistants non formatés ; le reformatage global est laissé à la décision de momo.

### 3.2 Client web (C1-C20)
| Id | Gravité | Emplacement | Constat | Statut | Note |
|---|---|---|---|---|---|
| C1 | Moyenne | `RolesTab.tsx:174` | Bascule de permission = `div` cliquable sans input (a11y) | Corrigé | `Toggle` partagé (`role=switch`) |
| C2 | Moyenne | `ProfileSection.tsx:61` | Zone de bannière cliquable sans rôle, `tabIndex` ni clavier | Corrigé | motif de `MyServerProfileTab.tsx:127-131` |
| C3 | Basse | `ProfileSection.tsx:98-101`, `126-129` | Champ fichier non réinitialisé (re-choisir le même fichier ne fait rien) | Corrigé | |
| C4 | Moyenne | `users.rs` `update_me` + `ProfileSection.tsx` | Impossible de retirer son avatar | Corrigé | serveur accepte `avatar: ""` ; bouton corbeille côté client |
| C5 | Moyenne | `UserPopup.tsx:259-299` | Relations : demande reçue sans Accepter/Refuser ; utilisateur bloqué avec « Envoyer un message » ; soi-même avec « Message » au lieu de « Modifier le profil » | Corrigé | |
| C6 | Moyenne | `UserPopup.tsx`, `UserProfilePage.tsx:333-336`, `KanbanBoard.tsx:30-40`, `SiteAdminPage`, `AuditLogPage`, `ThreadPanel`, `StickerPicker`, `Onboarding`, `MemberModeration`, `QuickSwitcher`, `afk.ts:50` | Textes en dur hors i18n (plus de 100) ; `activity_type` affiché brut | Corrigé | 2026-10-14 : `HealthTabs`, `FloatingCallPiP`, `RegisterPage` passés en i18n (`parts/auditRest.ts`) ; tous les `window.prompt`/`confirm` remplacés par `ConfirmModal`/`TextPromptDialog` (`DiscordSyncTab`, `ThemeGallery`, `AppearanceSection`, `PasskeysSection`, `SessionsSection`, `FriendSections`, `SiteAdminPage`, `ServerHeader`). Seul reste : `k.label` des événements de sécurité vient du serveur ; `ServerAdminPage` passe des textes FR en dur à `confirm()` |
| C7 | Basse | `UserPopup.tsx:137-146`, `:121` | `role=dialog` sans focus initial ni retour du focus ; `isSheet` calculé une seule fois | Corrigé | `matchMedia` |
| C8 | Basse | `UserPopup.tsx:109-117` | `useEffect([])` capture un `onClose` figé ; `react-hooks/exhaustive-deps` désactivé partout | Corrigé | règle remise en `warn` : 85 avertissements existants à traiter |
| C9 | Basse | `ChannelSidebar.tsx:383-386` | Sourdine optimiste sans `.catch` | Corrigé | retour arrière + toast |
| C10 | Basse | `MyServerProfileTab.tsx:37-45` | L'effet réinitialise tous les champs à chaque rafraîchissement du membre | Corrigé | initialisation une fois par serveur |
| C11 | Basse | `App.tsx:906-913` | `USER_UPDATE` ne met pas à jour `useAuth.user` pour soi ni n'invalide `['profile', id]` | Corrigé | |
| C12 | Basse | `GET /users/:id/profile` + `ProfileLinks` | Comptes connectés jamais affichés publiquement | Corrigé | via le lot E1 (section 4.5) |
| C13 | Basse | `store/channelNotif.ts:126` | `catch {}` muet | Corrigé | avertissement + nouvel essai à l'ouverture du WS |
| C14 | Basse | `CalendarView.tsx:227`, `ChannelSidebar.tsx:704`, `QuickSwitcher.tsx:288`, `SiteAdminPage.tsx:133`, `FloatingCallPiP.tsx:138`, `useUpdateNotifier.tsx:78` | Éléments cliquables inaccessibles au clavier | Corrigé | 2026-10-14 : `FloatingCallPiP` (boutons `type=button` + `aria-label`, section étiquetée) ; lignes de `MemberList` atteignables au clavier (Entrée/Espace) |
| C15 | Moyenne | page profil | 3 boutons Enregistrer séparés, pas de garde des modifications non enregistrées, aperçus partiels | Corrigé | barre unique + garde de sortie |
| C16 | Basse | `UserPopup` | Anneau seulement par serveur ; le popup n'affiche pas `server_avatar_ring` | Corrigé | anneau global + affichage serveur ?? global |
| C17 | Basse | profil | `profile_color_*` limité à un dégradé de fond | Partiel | carte de profil (styles, motifs) ajoutée |
| C18 | Basse | `ProfileSection.tsx:109` | Aperçu d'avatar sans décoration ; pas de recadrage | Partiel | aperçu complet ; 2026-10-14 : recadrage carré de l'avatar (`ImageCropDialog`, profil global et profil de serveur ; GIF/APNG/WebP animés envoyés sans recadrage) ; bannière non recadrée volontairement (`ProfileBanner` affiche la bannière entière) |
| C19 | Info | `ProfileLinks.tsx:17` | `key={l.url}` peut être en double | Corrigé | |
| C20 | Info | `MessageList`, `MemberList` | Pas de virtualisation (P2-8) | Partiel | `MemberList` déjà virtualisée à la main (lignes de 48 px en position absolue) ; `MessageList` non virtualisée (risque d'ancrage du défilement avant déploiement) |

Bug trouvé en route : l'éditeur de surcharges de permissions tronquait les bits à 32 bits (STREAM = 2^40
était ignoré) ; passé en `BigInt`. Corrigé.

#### Suites côté client des corrections bureau (X1-X4)
| Id | Gravité | Emplacement | Constat | Statut | Note |
|---|---|---|---|---|---|
| X1 | Moyenne | `RemoteSupport.tsx:87` | `launchGhd` ouvrait l'URL via `plugin:shell|open` ; doit appeler `ghd_launch {action, code, id, ttl}` -> `Promise<boolean>` (`false` = annulé, pas de toast « non installé ») | Corrigé | ancienne appli sans `ghd_launch` -> toast « non installé » (voulu) |
| X2 | Test | `client/scripts/remoteSupport.playwright.mjs:48,111,122-123` | Mock et assertions à aligner sur `ghd_launch` | Corrigé | script mis à jour, non exécuté (section 6) |
| X3 | Basse | `RemoteSupport.tsx:33` | `canHostGhd` cherche `Windows NT` alors que l'agent utilisateur du bureau est `ForgeChat/x (Desktop)` | Corrigé | plateforme lue via `system_get().platform` |
| X4 | Basse | réglages PTT | `register_ptt_shortcut` refuse maintenant une touche sans modificateur (sauf F1-F24) ; l'erreur n'allait qu'en console | Corrigé | erreur visible |

#### Suites côté client et mobile des corrections serveur (Y1-Y3)
| Id | Gravité | Emplacement | Constat | Statut | Note |
|---|---|---|---|---|---|
| Y1 | Basse | `MemberList`, requêtes `['members']`, mobile `members.tsx` | `GET /servers/:id/members?after=&limit=` renvoie 1000 au plus par page : sans pagination, liste tronquée au-delà | Corrigé | client et mobile paginent |
| Y2 | Basse | `PATCH /users/me {avatar: ""}` | Retrait d'avatar à exposer dans l'interface | Corrigé | voir C4 |
| Y3 | Basse | création de groupe MP | Création refusée entièrement si un membre refuse (403/404) : message clair nécessaire côté client et mobile | Corrigé | déjà en place : `DmList` et `GroupDMPage` affichent le message d'erreur du serveur |

Fichiers client au-delà de 800 lignes (préexistants) : `i18n/fr.ts` et `en.ts` (~2440), `MessageInput`
1671, `GroupDMPage` 1363, `MessageList` 1228, `App` 1229, `store/voice` 1113, `ServerSidebar` 987,
`ChannelPage` 950, `ServerSettingsModal` 896. `themeCore` (952) a été découpé.

### 3.3 Mobile (M1-M14)
| Id | Gravité | Emplacement | Constat | Statut | Note |
|---|---|---|---|---|---|
| M1 | Moyenne | `settings/profile.tsx:44-64`, `81-98` | Formulaire initialisé une seule fois ; Enregistrer renvoie tous les champs -> écrasement par des valeurs vides ou périmées | Corrigé | montage après chargement + PATCH des seuls champs modifiés |
| M2 | Moyenne | `AdminScreen.tsx` (~25, `toLocaleString('fr-FR')` l.83), `verify-email.tsx`, `register.tsx`, `you.tsx:86`, `events/new.tsx:73`, `DevInfo.tsx`, `ServerPicker.tsx` | Textes en dur hors i18n | Corrigé | |
| M3 | Moyenne | `e2e/conversations.ts:193`, `:434` | Échec d'envoi des enveloppes de clés avalé | Corrigé | avertissement + propagation pour nouvel essai |
| M4 | Basse | `settings/appearance.tsx:91` | `setTheme().catch` silencieux | Corrigé | |
| M5 | Basse | `register.tsx:29` | Échec de `registration-info` ignoré | Corrigé | erreur + Réessayer |
| M6 | Basse | `user/[userId].tsx:69` | `ProfileEffect` sans `key` (pas de remontage au changement d'effet) | Corrigé | |
| M7 | Basse | `settings/profile.tsx:122-128` | `void pick()` : rejets non gérés | Corrigé | |
| M8 | Basse | `settings/profile.tsx:150` | Aperçu sans `decorationOpts` | Corrigé | |
| M9 | Basse | `lib/http.ts:335` | Comparaison sur le texte « Accès interdit » au lieu d'un code d'erreur | Corrigé | 2026-10-14 : `AppError::Forbidden` renvoie `{"error":"Accès interdit","code":"forbidden"}` ; `parseError` mobile lit le code d'abord, repli sur le texte pour les anciens serveurs ; 3 tests |
| M10 | Basse | `security.tsx:31`, `AccountSwitcher.tsx:14`, `register.tsx:29` | `setState` après un appel asynchrone sans garde de montage | Corrigé | |
| M11 | Basse | `server/[serverId]/nickname.tsx:57-58` | Sauvegarde partielle possible | Corrigé | |
| M12 | Test | `__tests__/theme.test.ts:19-20` | Test tautologique | Corrigé | compare désormais les fichiers web et mobile |
| M13 | Test | tests de parité | Bornes absentes des tests (`RING_WIDTH_MAX`, plages, `DECO_RANGES`, `TAG_BADGES/ICONS`) | Corrigé | |
| M14 | Info | i18n mobile | 34 clés sans anglais (`nameStyleMore`) | Corrigé | |

Également corrigés : 2 tests `call-service-module` qui échouaient à cause des fins de ligne CRLF (correction dans le test).

#### Parité mobile / web
| Écart relevé | Statut | Note |
|---|---|---|
| Anneau absent de la liste des membres et des messages | Corrigé | |
| Pas de style de pseudo par serveur | Corrigé | |
| `NameStyleEditor` sans vitesse, angle, 2e couleur de contour, préréglages | Corrigé | vitesse, angle et 2e couleur ajoutés ; préréglages à vérifier |
| Pas d'éditeur de style d'étiquette | Corrigé | |
| Couleurs de profil limitées à une palette fixe | Corrigé | sélecteur libre |
| Pas de bouton « Retirer la bannière » | Corrigé | |
| Pas d'éditeur de thème | Non corrigé | 2026-10-14 : écran complet impossible à vérifier sans appareil |
| Pas de passkeys | Non corrigé | 2026-10-14 : module natif nécessaire, fichiers `assetlinks.json` / `apple-app-site-association` absents, build natif et appareil requis |

Limite connue : le rendu React Native est une approximation (pas de SVG ni de dégradés natifs ; lueur
absente sur Android). Fichier mobile au-delà de 800 lignes : `stores/voice.ts` (972).

### 3.4 Bureau Tauri (D1-D9)
| Id | Gravité | Emplacement | Constat | Statut | Note |
|---|---|---|---|---|---|
| D1 | Moyenne | ouverture shell | L'expression régulière d'ouverture accepte `ghosthanddesk://` avec des paramètres libres | Corrigé | commande `ghd_launch` validée + confirmation native |
| D2 | Basse | `nv_connect` (Linux) | URL et serveurs ICE non validés | Corrigé | seul `wss://forgechat.heiphaistos.org` est accepté (LiveKit local de dev refusé) |
| D3 | Basse | `update_install` | Fait confiance à `portable`/`target` envoyés par le front | Corrigé | |
| D4 | Basse | `register_ptt_shortcut` | Accepte n'importe quelle touche | Corrigé | modificateur requis sauf F1-F24 (voir X4) |
| D5 | Basse | `save_file` | Pas de plafond de taille ; liste d'extensions exécutables incomplète | Corrigé | |
| D6 | Basse | voix/vidéo native | `Mutex::lock().unwrap()` (panique si verrou empoisonné) | Corrigé | |
| D7 | Basse | CSP | `img-src https:` (signalé seulement) | Documenté | à traiter avec un proxy d'images ; non fait le 2026-10-14 : un proxy d'images serveur ajoute une surface SSRF non testable sans infra la veille du déploiement |
| D8 | Basse | agent utilisateur | Version 3.27.0 figée | Corrigé | |
| D9 | Info | fenêtres détachées | Pas de filtre de navigation | Corrigé | |

Bug trouvé en route : `nv_popout` acceptait `ws://127.0.0.1:80@evil.example` (hôte réel = `evil.example`). Corrigé.
Qualité : clippy et fmt verts sur le bureau (3 erreurs clippy préexistantes corrigées, `cargo fmt` appliqué).
`updater.rs` dépasse 800 lignes (1043). Le code `cfg(linux)` n'a pas été compilé (poste Windows).

### 3.5 Responsive web (2026-10-14)

#### Méthode
- Playwright 1.63.0 (Chromium 1243), build de production servi par `vite preview`, API simulée par
  `page.route` (`scripts/responsive.mocks.mjs`), WebSocket coupé.
- Tailles : 320x640, 360x740, 390x844, 414x896, 768x1024 en portrait ; 740x360 et 844x390 en paysage ;
  émulation mobile tactile. 22 pages x 7 tailles = 154 vérifications.

#### Tests ajoutés
- `client/scripts/responsive.playwright.mjs` (usage :
  `PW_MODULE=<chemin>/playwright/index.mjs node scripts/responsive.playwright.mjs`). Échoue si le
  `scrollWidth` du document ou de `body` dépasse `innerWidth`, si un conteneur `overflow-x:hidden` est
  décalé, si une zone pleine largeur défile horizontalement, ou si un champ est sous 16 px en dessous de 768 px.
- `client/scripts/imageCrop.playwright.mjs` vérifie le recadrage à 360 et 320 px (envoi d'un PNG carré 400x400).

#### Pages testées
- Publiques : accueil, connexion, inscription, `/telecharger`, `/fonctionnalites`.
- Connectées (simulées) : salon, tiroir, membres, fiche profil, réglages serveur, réglages salon, création
  de serveur, écran de clé E2E, vocal avant et pendant un appel, MP, groupe, amis, Réglages compte / profil / apparence.

#### Corrections
Fichier principal : `client/src/responsive.css`.

| Constat | Correction |
|---|---|
| En-têtes de salon et de MP coupés entre 320 et 414 px | actions défilantes, nom tronqué |
| En-tête de groupe à 7 boutons | retour à la ligne |
| Tiroir élargi à 570 px par le panneau utilisateur, fond transparent, boutons de 44 px qui écrasaient le nom de salon | largeur, fond et boutons corrigés |
| Bulles de groupe poussées hors écran par la barre d'actions ; liens, mots et code longs | bulles contenues, coupure des longs contenus |
| Composer écrasé à 768 px | mise en page corrigée |
| Zoom iOS : champs en `text-sm`/`text-xs` sous 16 px sur 16 pages sur 21 | 16 px forcé sous 768 px |
| Interrupteurs déformés par la règle des 44 px | interrupteurs exclus de la règle |
| Nom du serveur et bouton Fermer écrasés dans Réglages serveur (aussi sur ordinateur) | en-tête corrigé |
| Grandes modales sur téléphone | plein écran |
| Encoches et bords arrondis | `safe-area-inset` en haut et sur les côtés |
| Pseudo long dans l'en-tête de message | tronqué |
| Liste des membres ouverte par défaut sur petits écrans | ouverte par défaut seulement dès 1024 px |
| Pas de retour pendant un appel vocal | bouton retour |
| Fiche profil qui passait sous le composer | rendue dans un portail |
| Onglet Rôles sur téléphone | colonnes empilées |
| Pastille appareil photo qui couvrait l'avatar | repositionnée |

#### Non testé
Vrai clavier virtuel iOS/Android (iOS Safari ignore `interactive-widget`), appel réel avec participants,
vidéo et partage d'écran, forum, fils, recherche, épinglés, actualités, pages d'administration, invitation, explorer.

#### Restes
- En paysage 740x360, la zone des messages ne fait qu'environ 150 px.
- Barre d'actions visible sous chaque bulle de groupe sur téléphone (pas d'appui long).
- Boutons d'action de la ligne du salon ouvert à 36 px.
- Certaines règles CSS ciblent des classes Tailwind existantes ; le test les surveille.

### 3.6 Bugs trouvés le 2026-10-14

| Bug | Emplacement | Statut |
|---|---|---|
| Pièces jointes éphémères qui n'expiraient jamais : le client ajoutait `ttl_hours` après le fichier alors que le serveur l'applique aux fichiers suivants | `e2e/files.ts` | Corrigé |
| Clé anti-spam MP sans TTL : 429 définitif | `friends.rs` | Corrigé |
| Échec d'insertion dans `user_sessions` avalé sans log | `auth.rs` | Corrigé |
| Suppression de passkey sans message d'erreur | client | Corrigé |
| Libellés non reliés aux champs sur connexion et inscription | client | Corrigé |
| Échap dans `TextPromptDialog` fermait aussi les Paramètres | client | Corrigé |
| `store_attachments` garde le 1er fichier si le 2e est refusé (doublons au nouvel essai) | serveur | Non corrigé |
| `send_dm` ne vérifie que le blocage destinataire -> expéditeur | serveur | Non corrigé |
| Anti-spam MP ouvert si `incr` Redis échoue | serveur | Non corrigé |
| `verify_email` limité par adresse seulement | serveur | Non corrigé |
| Aide du profil « Cliquez sur l'avatar » alors que seul le bouton appareil photo ouvre le sélecteur | client | Non corrigé |

---

## 4. Fonctions ajoutées type Discord (migration 137)

Toutes les routes sont sous `/api`, authentifiées. Erreurs : 400 validation (message en français), 403 droit
manquant, 404 introuvable, 429 limite de débit. `CAN_EDIT` = MANAGE_CHANNELS ou EDIT_CHANNELS (convention
de `handlers/channel_access.rs`). Les corps refusent les champs inconnus.

### 4.1 Catégories
| Route | Droit | Effet | Événement WS |
|---|---|---|---|
| `PATCH /servers/:sid/categories/:cid` | CAN_EDIT | renommer (`name` rogné, 1 à 100) | `CATEGORY_UPDATE` |
| `PATCH /servers/:sid/categories/reorder` | CAN_EDIT (+ ADMINISTRATOR pour les catégories staff) | `category_ids` 1 à 500, sans doublon ; position = rang | `CATEGORIES_REORDER` (sans les catégories staff pour les non-admins : le client n'applique que les ids reçus) |
| `GET /servers/:sid/categories/:cid/permissions` | CAN_EDIT | liste des surcharges | - |
| `PUT .../permissions/:target_id` | CAN_EDIT | surcharge `{target_type, allow, deny}`, mêmes règles qu'un salon (jamais ADMINISTRATOR, seulement des bits possédés, cible sous l'acteur) | `CATEGORY_PERMISSION_UPDATE` |
| `DELETE .../permissions/:target_id` | CAN_EDIT | retrait idempotent | `CATEGORY_PERMISSION_UPDATE` |
| `POST /servers/:sid/categories/:cid/sync-permissions` | CAN_EDIT | remplace les surcharges de chaque salon de la catégorie, tout ou rien | `CHANNEL_PERMISSION_UPDATE` par salon |

Les surcharges de catégorie ne s'appliquent pas directement : elles sont recopiées sur les salons (à la
synchronisation et à la création d'un salon dans la catégorie). Une catégorie `staff_only` répond 404 aux
non-administrateurs et garde toujours un refus de VIEW_CHANNEL pour @everyone. Nouvelle table pour les surcharges de catégorie.

### 4.2 Marquer comme non lu
- `POST /channels/:channel_id/unread` et `POST /dms/:dm_id/unread` (MP 1:1 ou groupe), corps `{message_id}`.
- La position de lecture est placée juste avant ce message (elle peut reculer, contrairement à `/read`).
- Réponse `{ok, read_at, count, mention_count}` ; WS `READ_STATE_UPDATE` avec `unread: true` envoyé à
  toutes les sessions de l'utilisateur. Le client applique `count`/`mention_count` tels quels. En MP, tout non-lu compte comme mention.

### 4.3 Statut de salon vocal
- `PUT /servers/:sid/channels/:cid/voice-status`, corps `{status}` : 500 caractères au plus, une ligne,
  sans caractère invisible, de contrôle ou bidi ; `null` ou `""` efface.
- Droit : être connecté à ce salon, ou CAN_EDIT. Limite : 10 changements par 60 s. Salons `voice`/`stage` seulement.
- WS `CHANNEL_UPDATE` partiel ; champ `voice_status` lu dans la liste des salons.
- Effacement automatique quand le dernier membre quitte le salon : ajouté après la rédaction du contrat
  (`channel_extras::clear_voice_status`, appelé depuis `websocket::cleanup_voice`, par où passent tous les départs),
  avec diffusion `CHANNEL_UPDATE {voice_status: null}`. Le SQL n'a pas été exécuté sur une base réelle.

### 4.4 Suivi des invitations
- Chaque adhésion par invitation enregistre le code dans `server_members.joined_via_invite` (même transaction).
  Les adresses publiques ou personnalisées ne sont pas suivies.
- `GET /servers/:sid/invite-tracking` (MANAGE_SERVER) : 100 invitations les plus récentes avec créateur et
  membres actuels arrivés par ce code (2000 au plus), plus les invitations supprimées qui ont amené des membres
  encore présents (`revoked: true`). Onglet dédié côté web.

### 4.5 Comptes connectés visibles (C12)
- Champ `visible` (défaut `false`) sur chaque compte ; `PATCH /user/connected-accounts/:platform {visible}`.
- `GET /users/:id/profile` renvoie `connected_accounts` (comptes visibles seulement, ordre de création).

### 4.6 Forum : réaction par défaut et consignes
- `PATCH /servers/:sid/channels/:cid/forum-settings` (CAN_EDIT, salons `forum`/`media`) :
  `default_reaction_emoji` (64 caractères au plus, une ligne) et `post_guidelines` (2000 au plus, retours à la ligne permis).
- Le serveur n'ajoute pas la réaction : le client la propose sur les publications.

### 4.7 Couverture par plateforme
| Fonction | Serveur | Web | Mobile |
|---|---|---|---|
| Catégories (renommer, réordonner, surcharges, synchro, héritage) | oui | oui | événements seulement |
| Marquer comme non lu | oui | oui | oui |
| Statut de salon vocal | oui | oui | oui |
| Suivi des invitations | oui | oui (onglet) | non |
| Comptes connectés visibles | oui | oui | affichage oui, bascule non |
| Forum : consignes | oui | oui | oui |
| Forum : réaction par défaut | oui | oui | non mentionné |

Nouveaux champs de salon : `voice_status`, `default_reaction_emoji`, `post_guidelines` (chaîne ou `null`).
Un test sans base construit tout le routeur axum pour détecter les conflits de routes (par exemple
`/categories/reorder` contre `/categories/:cid`).

---

## Résultats des gates (2026-10-13)

Passage final le 2026-10-13 sous Windows 11, après toutes les corrections.

| Domaine | Commande | Résultat |
|---|---|---|
| Client | `npm run lint` | OK (code 0) |
| Client | `npx tsc --noEmit` | OK (code 0) |
| Client | `node --test scripts/*.test.mjs` | OK : 230 tests, 230 réussis, 0 échec |
| Client | `npx vite build` (après suppression de `dist/`) | OK (2 avertissements INEFFECTIVE_DYNAMIC_IMPORT déjà présents) |
| Mobile | `npm run typecheck` | OK (code 0) |
| Mobile | `npx jest --ci --no-watchman` | OK : 104 suites, 710 tests, 0 échec |
| Mobile | `npm run lint` | OK (code 0) |
| Serveur | `cargo clippy --all-targets -- -D warnings` | OK (39 erreurs avant les corrections, 0 après) |
| Serveur | `cargo test` | OK : 265 réussis, 0 échec, 32 ignorés (tests qui demandent une base) |
| Serveur | `cargo fmt --check` | ÉCHEC, déjà présent avant : 2461 blocs non formatés dans tout le dépôt. Les nouveaux fichiers sont formatés. Le reformatage global est à décider à part |
| Bureau | `cargo fmt --check` | OK |
| Bureau | `cargo clippy --all-targets -- -D warnings` | OK |
| Bureau | `cargo test` | OK : 35 réussis, 0 échec, 3 ignorés |

État initial : client vert ; mobile avec 3 tests jest en échec ; serveur qui ne compilait pas sous Windows (`health.rs`), avec clippy en échec ; bureau avec clippy en échec.

## Résultats des gates (2026-10-14)

| Domaine | Commande | Résultat |
|---|---|---|
| Client | `npm run lint` | OK (code 0) |
| Client | `npx tsc --noEmit` | OK (code 0) |
| Client | `node --test scripts/*.test.mjs` | OK : 232 tests, 232 réussis, 0 échec |
| Client | `npx vite build` (après suppression de `dist/`) | OK |
| Client | `responsive.playwright.mjs` | OK : 154 vérifications |
| Client | `imageCrop.playwright.mjs` | OK à 360 et 320 px |
| Mobile | `npm run typecheck` | OK (code 0) |
| Mobile | `npx jest --ci --no-watchman` | OK : 104 suites, 713 tests, 0 échec |
| Mobile | `npm run lint` | OK (code 0) |
| Serveur | `cargo clippy --all-targets -- -D warnings` | OK |
| Serveur | `cargo test` | OK : 269 réussis, 0 échec, 32 ignorés (tests qui demandent une base) |

---

## 6. Ce qui n'a pas été vérifié

| Point | Raison | Conséquence |
|---|---|---|
| Migrations 136 et 137 et tout le SQL nouveau | pas de Postgres ni de Docker sur le poste | jamais exécutés contre une vraie base ; tests base (`#[ignore]`, dont `discord_features_end_to_end`) écrits mais non lancés |
| Tests navigateur | Playwright lancé le 2026-10-14 pour le responsive et le recadrage, avec API simulée | aucun parcours contre un vrai serveur ; `remoteSupport.playwright.mjs` toujours non exécuté |
| `sweep-orphan-uploads` (S6) | pas de base | requête sur le catalogue (`information_schema`) jamais exécutée |
| Clavier virtuel réel | pas d'appareil | comportement du clavier iOS/Android non vu (section 3.5) |
| Appareils mobiles | pas d'appareil ni d'émulateur | rendu des anneaux, cartes et effets non vu sur iOS/Android |
| Code Linux du bureau | poste Windows | blocs `cfg(linux)` (dont `nv_connect`) non compilés |
| Effacement automatique du statut vocal | pas de base | `clear_voice_status` non exécuté contre Postgres |
| Préréglages du `NameStyleEditor` mobile | absent du suivi | à vérifier |
| Anciens pseudos non latins (S10) | pas de base | non revérifiés |

---

## 7. Reste à faire et propositions (par priorité)

| Rang | Sujet | Pourquoi | Réf. |
|---|---|---|---|
| 1 | Exécuter les migrations 136/137 et les tests base `#[ignore]` sur un Postgres jetable | tout le SQL nouveau est non testé ; un échec de migration bloque le déploiement | section 6 |
| 2 | Lancer Playwright (dont `remoteSupport`) et un essai sur appareil mobile (partiellement fait le 2026-10-14 : responsive et recadrage avec API simulée) | aucune vérification de bout en bout contre un vrai serveur | section 6 |
| 3 | Décider de la règle des pseudos (latin seul ?) et revérifier les pseudos existants | choix produit qui touche des comptes existants | S10 |
| 4 | Balayage ponctuel des fichiers orphelins sur disque (fait en lecture seule le 2026-10-14) | obligation RGPD d'effacement | S6 |
| 4b | Ajouter `--delete` au balayage après relecture d'une première liste en production ; compléter `remove_unreferenced` (7 colonnes ignorées) | effacement effectif des orphelins | S6 |
| 5 | Code d'erreur structuré pour les 403 génériques (fait le 2026-10-14) | supprime la comparaison de texte côté mobile | M9 |
| 6 | Proxy d'images puis CSP `img-src` restreinte | réduit le pistage par image externe | D7 |
| 7 | Virtualisation de `MessageList` (`MemberList` déjà virtualisée ; `MessageList` reste) | performances sur gros salons et serveurs > 1000 membres | C20, P2-8 |
| 8 | Demandes de message (MP d'inconnus) | protection contre le spam en MP | manque serveur |
| 9 | Réactions sur la publication de forum (route serveur absente) | complète la réaction par défaut | 4.6 |
| 11 | Recadrage avatar et bannière (avatar fait le 2026-10-14 ; bannière non recadrée volontairement) | demandé par l'audit profil | C18 |
| 12 | Passkeys et éditeur de thème sur mobile | parité avec le web | parité mobile |
| 13 | Restes i18n et a11y (faits le 2026-10-14) ; traiter les 85 avertissements `exhaustive-deps` (restent) | finir C6, C8, C14 | C6, C8, C14 |
| 14 | Droit des catégories : `CAN_EDIT` ou `MANAGE_CHANNELS` strict | aujourd'hui EDIT_CHANNELS suffit, à valider | 4.1 |
| 15 | Reformatage global `cargo fmt` du serveur (environ 2461 blocs), dans un commit isolé | évite de mélanger formatage et logique dans les diffs futurs | 3.1 |
| 16 | Découper les fichiers de plus de 800 lignes | client : `MessageInput`, `GroupDMPage`, `MessageList`, `App`, `store/voice`, `ServerSidebar`, `ChannelPage`, `ServerSettingsModal`, i18n ; serveur : `websocket.rs` ~1887, `servers.rs` ~1644, `users.rs` ~1043, `channels.rs` ~1037, `main.rs`, `state.rs` 848 ; mobile : `stores/voice.ts` 972 ; bureau : `updater.rs` 1043 | 3.x |
| 17 | Bannissement en masse | manque relevé côté serveur | manque serveur |
| 18 | Bots (options typées, composants), enregistrement vocal, SSO | fonctions plus lourdes, à planifier séparément | - |
