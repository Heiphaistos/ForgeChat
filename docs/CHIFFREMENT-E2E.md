# Chiffrement de bout en bout — conception (2026-10-07)

Demande de Momo : **tout chiffré de A à Z, le serveur (et son administrateur) ne doit jamais pouvoir lire une conversation**, avec une **clé de récupération** comme Forge Audio. Choix validés : salons de serveur chiffrés (fonctions refaites côté appli), historique en clair rechiffré par les applis, vocal/appels/écran chiffrés de bout en bout. **Décisions du 2026-10-07 (§12) : chiffrement OBLIGATOIRE et automatique partout, sans option ni mode de transition ; contenu des serveurs JAMAIS purgé (rechiffré par les applis) ; purge J+30 gardée pour les seuls MP et groupes.**

## 1. Modèle de menace
- Protégé : lecture de la base, des fichiers, des journaux, de la mémoire du serveur ; administrateur du VPS ; fuite de sauvegarde.
- Non protégé (limite assumée, dite dans la politique de confidentialité) : un serveur **modifié activement** qui servirait un client web piégé ou mentirait sur la liste des membres / les clés publiques. Atténuations : codes de sécurité vérifiables entre deux personnes, alerte « la clé de X a changé », applis mobiles/bureau signées (le code ne vient pas du serveur).
- Métadonnées visibles du serveur (nécessaires au fonctionnement) : qui parle dans quel salon et quand, noms des serveurs/salons, pseudos/avatars, réactions (emoji), identifiants des personnes et rôles mentionnés et @everyone/@here (pour notifier), votes des sondages (par option, sans leur texte), nombre d'options d'un sondage, tags de forum, tailles des fichiers.

## 2. Primitives (identiques web ↔ mobile, octet pour octet)
- Web/bureau : WebCrypto. Mobile : `@noble/curves` (p256), `@noble/hashes` (sha256, hkdf, pbkdf2), `@noble/ciphers` (gcm). **Vecteurs de test communs** (`docs/e2e-vectors.json`) vérifiés par les deux suites de tests.
- Courbe : **ECDH P-256** (universel en WebCrypto, y compris WebKitGTK). Clé publique = point non compressé 65 octets, base64url.
- Symétrique : **AES-256-GCM**, IV 12 octets aléatoire, AAD obligatoire (voir §4).
- Dérivation : **HKDF-SHA256**. Mot de passe/code : **PBKDF2-SHA256, 600 000 itérations**, sel 16 octets.
- Encodage : base64url sans remplissage. Toute structure chiffrée porte `v` (version).

## 3. Clé de compte
- À la première connexion d'une appli compatible : paire ECDH P-256 générée **sur l'appareil**.
- Stockée sur le serveur : `public` (clair) + `wrapped` = clé privée (PKCS8 sur web, scalaire 32 o sur mobile → on stocke le **scalaire 32 octets**, le web l'importe en JWK `d`) chiffrée par AES-GCM(PBKDF2(mot de passe, sel)), AAD `forgechat key v1|<user_id>`.
- **Code de récupération** : 20 caractères (alphabet Crockford base32, 100 bits), affiché **une seule fois** à la création, téléchargeable ; `backup` = même clé privée chiffrée par PBKDF2(code), AAD `forgechat backup v1|<user_id>`.
- Connexion sur un nouvel appareil : l'appli télécharge `wrapped`, le déchiffre avec le mot de passe saisi (côté appareil, jamais envoyé déchiffré), garde la clé privée **non extractible** (IndexedDB CryptoKey sur web ; SecureStore sur mobile).
- Changement de mot de passe : l'appli ré-enveloppe (`wrapped`) et l'envoie avec la requête de changement (atomique).
- Mot de passe oublié : la réinitialisation par e-mail ne rend PAS les messages ; l'écran propose « entrer mon code de récupération » (ré-enveloppe) sinon « nouvelle clé : l'ancien historique chiffré devient illisible pour toi ».
- Fingerprint = SHA-256 de la clé publique ; **code de sécurité** (60 chiffres comme Signal) entre deux comptes, affiché sur les profils.
- Le serveur refuse d'écraser une clé existante sans le jeton de réinitialisation (409 KEY_EXISTS), garde les 20 anciennes clés publiques (`old`).

## 4. Conversations
### 4.1 Clé de conversation (MP, groupes, salons — même mécanisme partout)
- Chaque conversation (MP 1:1, groupe, salon texte/annonces/forum/médias/vocal, fil = clé du salon parent) a des **époques** : `(conv_id, epoch)` → clé symétrique aléatoire 32 octets.
- Distribution : pour chaque membre autorisé, `wrapped_key = AES-GCM(HKDF(ECDH(priv_émetteur, pub_membre), info "forgechat ck v1|<conv>|<epoch>|<membre>"), clé)`, AAD `ck v1|<conv>|<epoch>|<membre>|<émetteur>`. Table serveur `conversation_keys(conv_id, epoch, member_id, wrapped, wrapped_by, created_at)`.
- Le serveur fournit la **liste des membres autorisés** (MP : les 2 ; groupe : membres ; salon : membres ayant VIEW_CHANNEL) et ne renvoie à chacun **que ses propres enveloppes**.
- Nouveau membre / nouveau droit : le serveur publie une demande (événement WS `KEY_REQUEST {conv, member}`) ; n'importe quel client en ligne qui possède la clé l'enveloppe pour lui (après vérification de la clé publique du demandeur) — par défaut **toutes les époques** (historique visible, comme Discord). En attendant : « Messages chiffrés en attente d'une clé — un membre doit se connecter ».
- Départ, exclusion, ban, perte de VIEW_CHANNEL : **rotation** : le prochain client qui envoie crée l'époque n+1 et l'enveloppe pour les membres restants (le serveur refuse un envoi sur une époque périmée : 409 EPOCH_STALE).
- Messages : `content` (clair) **interdit** ; champs `enc = {v:1, epoch, iv, ct}` ; texte en clair = JSON `{t: texte, f?: fichiers, p?: aperçu de lien, ...}` ; AAD `msg v1|<conv>|<epoch>|<auteur>|<id client du message>`.
- Édition : nouveau `enc`. Suppression : inchangée.
- Exceptions **en clair et marquées `unencrypted: true`** (affichées « non chiffré ») : messages de webhooks entrants, de bots, messages système. Les bots ne peuvent pas lire les salons chiffrés.

### 4.2 Fichiers
- Chiffrés sur l'appareil avant envoi : clé aléatoire par fichier, AES-GCM par blocs de 64 Kio (IV = préfixe 4 o aléatoire + compteur 8 o), le serveur stocke un blob opaque (`application/octet-stream`). Clé, nom, type MIME, dimensions, miniature (petite image chiffrée elle aussi) dans le contenu chiffré du message.
- Mobile : chiffrement en flux par blocs (pas tout en mémoire). Limite initiale 100 Mo pour un fichier chiffré sur mobile (le web garde 500 Mo) ; au-delà, message clair d'erreur.

### 4.3 Ce que le serveur faisait avec le contenu → côté appli
- Recherche : index local dans l'appli (messages déjà téléchargés/déchiffrés), recherche serveur limitée aux métadonnées (auteur, date, salon, a-une-pièce-jointe).
- AutoMod : règles toujours configurées sur le serveur, **appliquées par l'appli de l'expéditeur** avant chiffrement (contournable par un client modifié : limite assumée).
- Mentions/notifications : l'appli envoie en clair `mentions: [user_ids]`, `mention_everyone`, `reply_to` (métadonnées) ; le serveur notifie sans lire le texte. Aperçu des notifications : déchiffré sur l'appareil.
- Aperçus de liens : l'appli de l'expéditeur demande `/og` (le serveur voit l'URL un instant, ne la stocke pas), met l'aperçu dans le contenu chiffré.
- Traduction : désactivée dans les conversations chiffrées.
- Signalement : le signaleur envoie le texte déchiffré du message signalé (seul moyen de modérer), clairement indiqué à l'écran.
- Sondages, titres de fils/publications de forum, messages programmés, rappels, enregistrés : contenus chiffrés (les votes restent en clair). Messages programmés : chiffrés à la création.
- Annonces suivies (crosspost) : désactivées pour les salons chiffrés dans un premier temps (la copie exigerait la clé du salon cible).

## 5. Vocal, appels, partage d'écran
- LiveKit E2EE (trames chiffrées AES-GCM, insertable streams / frame cryptor) avec un fournisseur de clé externe : clé de média = HKDF(clé de conversation de l'époque courante, info "forgechat media v1|<conv>|<epoch>"). Nouvelle époque = nouvelle clé, nouvel index dans l'anneau de LiveKit.
- Livré à l'étape 5 : détails au §10.

## 6. Historique existant (rechiffrement ; purge des seuls MP et groupes)
- Le serveur garde les anciens messages en clair (`content` présent, `enc` NULL).
- L'appli de **l'auteur** rechiffre en arrière-plan ses anciens messages (par lots) dès qu'elle a la clé de conversation : accepté seulement si le message est encore en clair → le serveur écrase le texte (une seule fois : `enc` NULL → `enc`).
- **MP et groupes** : à J+30 du déploiement, tout ancien texte restant est purgé (remplacé par « message ancien supprimé »), journalisé en nombre seulement.
- **Salons de serveur (fils, forums, sondages compris) : JAMAIS purgés.** En plus de l'auteur, le propriétaire du serveur et les modérateurs rechiffrent l'ancien contenu des autres (§12).

## 7. Déploiement sans casse
- ~~Serveur compatible deux modes pendant la transition~~ (abandonné le 2026-10-07, §12) : tout texte en clair d'un utilisateur est refusé, partout. Anciennes applis : « Ce message est chiffré : mets à jour ForgeChat » (jamais d'erreur).
- Mises à jour mobile/bureau publiées AVANT d'activer l'obligation côté serveur ; version minimale imposée ensuite.

## 8. Étapes
1. Primitives + vecteurs communs + clé de compte (création, mot de passe, code de récupération, changement de mot de passe, oubli) — web, mobile, serveur.
2. MP 1:1 et groupes chiffrés (texte), refus du clair côté serveur pour ces conversations, rechiffrement de l'historique des MP.
3. Salons de serveur : clés par époque, demandes de clés, rotation, permissions ; mentions en métadonnées ; recherche locale ; AutoMod côté appli ; clé de récupération du serveur pour son propriétaire (ajout du 2026-10-07). Réalisée : §10 et §11.
4. Fichiers chiffrés (web + mobile, flux par blocs).
5. Vocal/appels/écran E2EE (LiveKit).
6. Purge J+30 (MP et groupes seulement), pages légales, codes de sécurité, tests de bout en bout (deux comptes, trois appareils, rotation).
7. Chiffrement obligatoire, contenu des serveurs jamais purgé et rechiffré par les applis (2026-10-07) : §12.

## 9. Étape 2 réalisée : MP 1:1 et groupes (texte)

### Formats
- Conversation dans l'AAD : `dm:<dm_id>` ou `group:<group_id>`.
- Enveloppe de clé d'époque : `{v:1, iv, ct}` (ct = 32 o + tag), clé = HKDF(ECDH(émetteur, membre), sel vide, `forgechat ck v1|<conv>|<epoch>|<membre>`), AAD `ck v1|<conv>|<epoch>|<membre>|<émetteur>`.
- Message : `enc = {v:1, epoch, iv, ct}`, clair = JSON `{t: texte}`, AAD `msg v1|<conv>|<epoch>|<auteur>|<client_msg_id>` ; `client_msg_id` = UUID tiré par l'appli, gardé à l'édition. `content` reste NULL.
- Vecteurs `convKey` et `message` dans `docs/e2e-vectors.json` (web et mobile).

### Serveur (migration 086)
- `conversation_epochs(conv_kind, conv_id, current_epoch, rotate_needed)`, `conversation_keys(conv_kind, conv_id, epoch, member_id, member_fp, wrapped, wrapped_by, wrapped_by_pub)`, colonnes `enc`, `client_msg_id`, `purged` sur `dm_messages` et `group_dm_messages`, `e2e_rollout(started_at)`.
- `GET /e2e/conversations/:kind/:id/keys` : MES enveloppes, époque courante, `rotate_needed`, `all_keyed`.
- `POST /e2e/conversations/:kind/:id/keys` `{epoch, create?, envelopes:[{member_id, member_fp, wrapped}]}` : seulement pour des membres et leur clé actuelle (sinon 403 / 409 KEY_CHANGED) ; `create` = époque 0 ou courante+1 après un départ, enveloppes pour exactement les membres munis d'une clé (409 MEMBERS_CHANGED / EPOCH_STALE pour le perdant d'une course). Diffuse `E2E_KEYS` aux destinataires.
- `POST /e2e/conversations/:kind/:id/keys/request` : diffuse `KEY_REQUEST {conv_kind, conv_id, member_id}` (aussi émis à l'ajout d'un membre).
- `GET /e2e/conversations/:kind/:id/members` : membres, clés publiques, empreintes.
- `GET /e2e/legacy` + `PUT /dms/:id/messages/:mid/encrypt`, `PUT /dms/groups/:id/messages/:mid/encrypt` `{enc, client_msg_id}` : rechiffrement par l'auteur seulement, message encore en clair seulement (sinon 409 NOT_LEGACY) ; efface aussi l'historique d'éditions et la copie des messages enregistrés.
- Envoi/édition : `enc` + `client_msg_id` ; clair toujours refusé depuis le §12 (400 `PLAINTEXT_REFUSED : …phrase…`), époque périmée ou rotation en attente : 409 EPOCH_STALE. Départ/exclusion d'un groupe : `rotate_needed`, enveloppes du partant supprimées.
- Purge horaire : 30 jours après `e2e_rollout.started_at`, le clair des messages ANTÉRIEURS au déploiement devient NULL + `purged` (nombre seul journalisé). Les messages en clair postérieurs (envoyés pendant l'ancienne transition) ne sont pas purgés ; ils sont rechiffrés par leur auteur (§12 : même si un membre n'a pas encore de clé).
- Recherche serveur : ne trouve plus les messages chiffrés (pas de texte) ; les applis cherchent dans les messages déchiffrés. Signalement et transfert d'un MP chiffré : texte fourni par l'appli (`content`). Traduction : impossible (404). Messages enregistrés : pas de copie du texte pour un MP chiffré.
- Push serveur (Expo, Web Push) : corps « Message chiffré » ; l'aperçu n'est déchiffré que par l'appli ouverte ou le mode « sans Google ».
- Anciennes routes de l'essai précédent (`/dms/:id/e2e`, `/users/me/pubkey`, `/users/:id/pubkey`) retirées ; tables `user_pubkeys` et `dm_e2e_messages` laissées en place (à supprimer après accord).

### Anciennes applis
- Web : servie par le serveur, toujours à jour au rechargement.
- Mobile/bureau d'avant cette étape : un message chiffré arrive avec `content = null` et s'affiche comme une bulle vide (auteur et heure, sans texte, aucune erreur). L'envoi de texte dans une conversation dont tous les membres ont une clé échoue avec le message du serveur « PLAINTEXT_REFUSED : cette conversation est chiffrée de bout en bout, mets à jour ForgeChat pour y écrire. ». Depuis le §12, plus de repli en clair : un membre sans clé ne lit qu'après avoir créé la sienne.

## 10. Étape 5 réalisée : vocal, appels, caméra, partage d'écran

### Clé de média
- `clé de média = HKDF-SHA256(clé de conversation de l'époque, sel vide, "forgechat media v1|<conv>|<epoch>", 32 o)`, encodée en base64url ; `<conv>` = `dm:<id>`, `group:<id>` ou `channel:<id du salon vocal>`.
- Cette **chaîne** est donnée à LiveKit, qui en dérive la clé AES-GCM des trames par PBKDF2 (sel `LKFrameEncryptionKey`) : c'est le seul chemin de dérivation commun au worker web, au FrameCryptor natif du mobile et au SDK Rust (le chemin HKDF de LiveKit n'existe que sur le web).
- Index de clé = `époque mod 16` (anneau de 16 clés). Clé partagée par tous les participants, aucun ratchet automatique (`ratchetWindowSize 0`, `failureTolerance -1`) : une trame illisible ne fait jamais jeter la bonne clé.
- Nouvelle époque pendant l'appel (départ d'un membre puis rotation, événement `E2E_KEYS`) : chaque appli relit l'époque courante, pose la nouvelle clé à son index et chiffre aussitôt avec ; les trames encore à l'ancien index restent lisibles (clé gardée dans l'anneau). Rejoindre un appel crée l'époque si besoin (première fois, rotation en attente), comme l'envoi d'un message (`currentKey`).
- Vecteur commun `media` dans `docs/e2e-vectors.json` (web `scripts/e2e.test.mjs`, mobile `__tests__/e2e-crypto.test.ts`), recoupé avec une implémentation HKDF indépendante (Python).
- Chiffrés : micro, caméra, partage d'écran et son du partage (toutes les pistes publiées), et les paquets du canal de données LiveKit (option `encryption`, réactions…).

### Serveur
- L'accès LiveKit joint au client porte `e2ee: true` **toujours** depuis le §12 (avant : quand tous les membres avaient une clé) : `VOICE_EXISTING_PEERS.livekit` (conversation `channel:<salon>`), `GROUP_CALL_MEDIA.livekit` (`group`), `DM_CALL_ACCEPTED/DM_CALL_MEDIA.livekit` (`dm`, plus `conv_id` : la conversation privée retrouvée par la paire d'utilisateurs, jamais l'id envoyé par le client). Erreur de base : `e2ee: true` (échec propre plutôt que clair).
- Générique sur `kind` : tant que le type `channel` n'existe pas côté serveur (`Conv::parse` le refuse), les salons vocaux restent en clair ; ils passent en chiffré **sans autre changement** dès que `channel` est ajouté à `Conv` (membres = VIEW_CHANNEL) et que les applis savent créer ses époques.
- Les applis à jour annoncent `e2ee: true` dans `VOICE_JOIN`, `GROUP_CALL_JOIN`, `DM_CALL_INIT`, `DM_CALL_ACCEPT` ; le jeton LiveKit porte alors l'attribut de participant `e2ee = "1"` (pour l'appelant d'un MP, l'annonce est gardée 60 s dans Redis `call_e2ee:<appelant>:<appelé>` jusqu'au décroché).

### Applis
- **Web** (`client/src/e2e/media.ts`, `mediaKeyProvider.ts`) : `Room({ encryption: { keyProvider, worker } })` + `setE2EEEnabled(true)` avant `connect`, worker `livekit-client/e2ee-worker` empaqueté par Vite (`new Worker(new URL(...), { type: 'module' })`, fichier servi depuis l'origine : CSP `worker-src 'self' blob:` déjà présente dans nginx et dans `desktop/src-tauri/tauri.conf.json`). Appels privés (`store/call.ts`), de groupe (`store/groupCall.ts`), salons vocaux (`store/voiceSfu.ts`).
- **Mobile** (`mobile/src/e2e/media.ts`) : `RNE2EEManager` + sous-classe de `RNKeyProvider` (module natif déjà présent dans `@livekit/react-native-webrtc` 144, **aucune configuration native supplémentaire**). Le `RNKeyProvider` d'origine ne suit l'index d'émission qu'en mode « une clé par participant » : la sous-classe le fournit, et les chiffreurs d'émission déjà créés reçoivent le nouvel index (champ privé `frameCryptors` du SDK, accès documenté dans le code). Appels privés, de groupe, salons vocaux.
- **Bureau Windows** : vue web WebView2, chemin web.
- **Bureau Linux** (voix native Rust, SDK LiveKit 0.9.1, FrameCryptor natif, sans nouvelle crate) : `nv_connect` reçoit `{ key, index }` du web et rejoint avec `E2eeOptions { Gcm }` ; `nv_set_key` pose la clé d'une nouvelle époque. Le SDK crée ses chiffreurs d'émission à l'index 0 : l'index courant leur est donné après chaque publication et changement de clé.
- **Jamais de connexion en clair** à une salle `e2ee: true` : clé verrouillée, clé en attente, navigateur sans insertable streams ni RTCRtpScriptTransform → message clair (« Déverrouille ta clé… », « Clé en attente… », « Ce navigateur ne sait pas chiffrer… ») et pas de connexion.
- Cadenas « Appel chiffré de bout en bout » dans l'écran d'appel privé, l'appel de groupe et le salon vocal (web et mobile, fr + en) ; participant sans l'attribut `e2ee = "1"` : « X n'a pas une version à jour de ForgeChat et n'entend que du bruit chiffré : il faut mettre à jour ForgeChat. »
- Clips (enregistrement local des dernières secondes) : ils enregistrent les pistes reçues, qui sont déjà déchiffrées (le déchiffrement a lieu avant le décodeur) ; le test navigateur ci-dessous lit justement le son par cette piste.

### Anciennes applis
- Une appli d'avant cette étape rejoint une salle chiffrée sans chiffrer : elle n'entend que du bruit (trames illisibles) et les applis à jour ne l'entendent pas (trames rejetées) ; son propre micro part en clair jusqu'au SFU (inévitable, l'appli ne sait pas chiffrer). Les applis à jour affichent l'alerte « mets à jour ForgeChat ».

### Tests
- Unitaires : vecteur `media` (web + mobile), `__tests__/e2e-media.test.ts` (clé et index donnés au fournisseur natif, nouvelle époque pendant l'appel, refus sans clé), `livekit.rs` (attribut `e2ee` du jeton), `livekit-url.test.ts` (champs `e2ee` / `conv_id`).
- Navigateur, **local uniquement** : `client/scripts/e2ee-media.playwright.mjs` + `client/e2ee-harness/` contre un `livekit-server` local lié à 127.0.0.1 (clé `devkey`). Mesuré le 2026-10-07 (LiveKit 1.13.7, Chromium 151) : même clé → 440 Hz reçu à −28 dB, piste annoncée chiffrée ; clé d'une autre conversation au même index → aucun son (6 erreurs « InvalidKey ») ; clé d'une autre époque → aucun son (« MissingKey »). Lancer : `PW_MODULE=<…>/node_modules/playwright/index.mjs node scripts/e2ee-media.playwright.mjs` (Playwright n'est pas une dépendance du projet).

### Limites connues
- Interopérabilité web ↔ mobile ↔ Linux natif : même format de trame LiveKit et même dérivation PBKDF2 (compatibilité annoncée par LiveKit pour le chemin « chaîne ») ; **vérifiée seulement de navigateur à navigateur**, pas encore sur un téléphone ni sur l'appli Linux (à faire avec deux appareils réels).
- Appli Linux native : pas d'alerte « participant à mettre à jour » (le processus natif ne remonte pas les attributs des participants) ; le chiffrement lui-même est actif.
- Salons vocaux : chiffrés seulement quand le type de conversation `channel` existe (étape 3).


## 10. Étape 3 réalisée : salons de serveur chiffrés (texte)

### Membres autorisés et époques
- Conversation `channel:<channel_id>` (kind `channel` dans les routes `/e2e/conversations/:kind/:id/...`), même mécanisme d'époques et d'enveloppes que les MP (§9). Un fil et une publication de forum utilisent la clé de leur salon.
- Membres autorisés = membres du serveur (hors bots) qui VOIENT le salon : rôles + @everyone + surcharges du salon (même règle que la diffusion `channel_audience_among`). Propriétaire et administrateurs voient tout.
- Les droits changent à beaucoup d'endroits (départ, exclusion, bannissement, retrait de rôle ou de permission, surcharge, salon rendu privé…) : **approche paresseuse**, aucun événement à émettre. À chaque envoi chiffré (et à chaque lecture des clés), le serveur vérifie que tous les détenteurs de l'époque courante voient encore le salon ; sinon il marque `rotate_needed` et répond 409 EPOCH_STALE. L'émetteur recharge, crée l'époque suivante pour les membres restants et renvoie. Un ancien membre ne lit plus rien (403 sur les clés et les messages) et n'a pas la clé des époques suivantes.
- Gain d'accès (arrivée, rôle, permission) : `GET …/keys` d'un salon renvoie `missing` (membres munis d'une clé auxquels l'époque courante manque, 200 au plus) ; l'appli d'un membre qui a les clés (à l'ouverture du salon et après un envoi, au plus une fois par minute) les enveloppe pour eux, toutes époques connues (historique visible). Le nouveau venu qui ne peut pas ouvrir un message demande aussi les clés (`KEY_REQUEST`, envoyé à 20 détenteurs connectés au plus).
- Grands serveurs : une nouvelle époque de salon est créée avec l'enveloppe du créateur (+ un premier lot) ; le reste est distribué par lots de 200 (redistribution `create: false`). O(n) enveloppes par époque. `GET …/members` est paginé (`?after=<uuid>`, 1000 par page, salons : seulement les membres munis d'une clé ; `?member=<uuid>` pour un seul).
- `GET …/keys` d'un salon ajoute `encrypt` (j'ai une clé : il faut chiffrer), `missing`, `server_key` (clé de récupération du serveur, §11) et `server_missing` (mes époques pas encore enveloppées pour elle).

### ~~Transition : on chiffre dès que l'émetteur a une clé~~ (remplacé par le §12 : chiffrement obligatoire)
Historique : contrairement aux MP (clair permis tant qu'un membre n'a pas de clé), un salon chiffre **dès que l'auteur a une clé de compte** : sur un serveur public avec beaucoup de membres sans clé, attendre bloquerait tout. Les membres sans clé de compte voient « 🔒 Message chiffré : crée ta clé de chiffrement pour le lire » ; ils en créent une à leur prochaine connexion avec une appli à jour (écran de clé) et reçoivent alors les époques (`missing`, `KEY_REQUEST`). Un membre sans clé (appli ancienne) peut encore écrire en clair ; ce message est marqué `unencrypted` (« non chiffré ») et sera rechiffré par son auteur quand il aura une clé.

### Formats (vecteurs `threadMessage`, `forumPost`, `poll`, `serverKey`, `serverEpoch` dans `docs/e2e-vectors.json`)
- Message de salon : `enc = {v:1, epoch, iv, ct}`, AAD `msg v1|channel:<salon>|<epoch>|<auteur>|<client_msg_id>`, clair `{t, p?}` (`p` = aperçu de lien calculé par l'expéditeur).
- Portée dans l'AAD (la clé reste celle du salon) :
  - fil : `channel:<salon>/thread:<client_id du fil>` ; titre du fil = `{t: titre}` avec `client_msg_id = client_id` ; `threads.title` vide ;
  - forum et salon média : `channel:<salon>/post:<client_msg_id de la publication>` ; publication = `{t: contenu, title: titre}` (`title` vide, `content` NULL côté serveur), réponses dans la même portée ;
  - sondage : `channel:<salon>/poll:<client_msg_id du sondage>`, clair `{t: question, o: [options]}` ; options stockées vides, ordre = `position` ; votes en clair (par id d'option).
- Messages programmés : chiffrés à la création comme un message du salon, recopiés tels quels à l'heure dite (pas de contrôle d'époque à l'envoi différé).
- Rappels : aucun texte côté serveur (l'événement `REMINDER` arrive sans contenu pour un message chiffré).

### Serveur (migration 087)
- `conversation_epochs` / `conversation_keys` acceptent `channel`. Colonnes `enc`, `client_msg_id`, `purged` sur `messages`, `thread_messages`, `forum_replies` (contenu désormais facultatif), `forum_posts` (`client_msg_id` toujours présent) ; `threads.client_id` + `title_enc` ; `polls.enc` + `client_msg_id` ; `scheduled_messages.enc` + `client_msg_id` ; `message_reports.content` (texte fourni par le signaleur) ; `e2e_rollout.channels_started_at`.
- Envoi, édition, réponse, transfert, fil, forum, sondage, message programmé : `enc` + `client_msg_id` ; le texte en clair est refusé (400 `PLAINTEXT_REFUSED : …`) dès que l'auteur a une clé, sauf **commande de bot** enregistrée sur le serveur (`/nom args`, destinée au bot donc lisible par lui). Webhooks, bots, flux RSS, annonces suivies et messages système restent en clair et sont renvoyés avec `unencrypted: true` (affichés « non chiffré »). Les bots ne reçoivent que `enc` pour un message chiffré : ils ne lisent pas les salons chiffrés.
- Mentions : l'appli envoie en clair `mentions: [user_id]`, `mention_roles: [role_id]`, `mention_everyone`, `mention_here` (bornés à 100 membres et 20 rôles) ; le serveur notifie (MENTION_CREATE, push) sans lire le texte, le corps des notifications poussées est « Message chiffré », `MENTION_CREATE` transporte `enc` pour un aperçu déchiffré sur l'appareil. Le texte d'un message chiffré n'est jamais analysé.
- AutoMod : `GET /servers/:id/automod/rules` (tout membre) ; l'appli applique mots interdits, liens, majuscules et anti-spam avant de chiffrer (contournable par un client modifié : limite assumée) ; le serveur garde la limite de mentions (métadonnées).
- Recherche serveur : seulement le texte en clair et les métadonnées (`from:`, `in:`, `has:fichier/image`, `before:`, `after:`) ; les applis cherchent dans les messages déchiffrés chargés. Traduction impossible (pas de texte) et masquée. Publication dans les salons abonnés refusée pour un message chiffré (409). Signalement : texte déchiffré fourni par le signaleur, marqué `encrypted` dans la liste des signalements (non vérifiable par le serveur). Enregistrés, épingles, mentions non lues, sauvegarde d'un salon avant suppression et export RGPD : forme chiffrée (ou `encrypted: true`), jamais de copie du texte.
- Édition chiffrée : l'historique des éditions et la copie des enregistrés sont effacés (aucun ancien texte gardé) ; une édition en clair d'un message chiffré est refusée.
- Rechiffrement de l'historique par l'AUTEUR : `GET /e2e/legacy/channels` (mes anciens messages, messages de fil, réponses et publications de forum, dans les salons que je vois encore ; route séparée pour que les applis de l'étape 2 ne les reçoivent pas) puis `PUT /e2e/legacy/channel/:item/:id {enc, client_msg_id}` (`item` = `message`, `thread_message`, `forum_reply`, `forum_post` ; une publication garde son `client_msg_id`). 409 NOT_LEGACY si ce n'est pas un ancien texte de l'appelant.
- ~~Purge horaire, 30 jours après `channels_started_at`~~ : **supprimée le 2026-10-07** (§12), le contenu des serveurs n'est jamais purgé. Le rechiffrement est décrit au §12.
- Suppression d'un salon : ses enveloppes sont supprimées.

### Applis (web et mobile)
- Modules cœur : `e2e/conversations.ts` (kind `channel`, `sealBody` avec portée, distribution par lots, `completeChannelKeys`, rechiffrement de l'historique des salons), `e2e/channelText.ts` (mentions en métadonnées, AutoMod, première URL ; fonctions pures testées à l'identique des deux côtés), `e2e/serverKey.ts` (§11).
- Aperçus de liens : l'expéditeur demande `/og` (le serveur voit l'URL un instant, ne la stocke pas) et met l'aperçu dans le contenu chiffré ; les destinataires ne demandent rien au serveur pour un message chiffré.
- Écrans branchés (web et mobile) : messages, réponses, éditions, épingles, fils (titres compris), forums et salons médias, sondages, messages programmés, enregistrés, mentions, recherche locale, transfert (rechiffré pour un salon cible chiffré), signalement, badge « non chiffré », cadenas d'en-tête, onglet « Chiffrement » des réglages du serveur (§11), invitation du propriétaire, transfert de propriété.
- Limites connues : ~~renommer un fil chiffré est masqué~~ (renommage chiffré depuis le §12, web) ; l'AutoMod de l'appli ne vérifie pas les options de sondage ni le titre d'une publication, ni l'édition sur mobile ; un message programmé chiffré ne notifie pas ses mentions (le serveur le recopie sans métadonnées) ; une publication de forum chiffrée n'a pas d'aperçu de lien ; la récupération du serveur ne couvre que les messages des salons (pas les fils, forums ni sondages) et l'export mobile passe par la feuille de partage (taille bornée, export salon par salon au-delà).

### Anciennes applis
- Web : servie par le serveur, à jour au rechargement.
- Mobile/bureau d'avant cette étape : un message de salon chiffré s'affiche comme une bulle vide (auteur, heure) ; l'envoi en clair d'un utilisateur muni d'une clé échoue avec « PLAINTEXT_REFUSED : … mets à jour ForgeChat pour y écrire. ». Le refus est actif dès le déploiement de la migration 087 : **publier les applis mobiles/bureau à jour avant de déployer le serveur** (§7).

## 11. Clé de récupération du serveur (ajout du 2026-10-07, demandé par le propriétaire de la plateforme)

But : le **propriétaire d'un serveur** peut toujours déchiffrer et récupérer tout le contenu de ses salons (même un salon privé dont il n'est pas membre, même s'il perd son compte) ; la plateforme (serveur, VPS, administrateur) ne peut toujours rien lire. Les MP et groupes ne sont pas concernés.

- Paire ECDH P-256 « clé de serveur » générée par l'appli du propriétaire (Réglages du serveur > Chiffrement, ou invitation à l'ouverture de son serveur). Stockés (`server_keys`) : la clé publique, son empreinte, `recovery` = clé privée (scalaire 32 o) chiffrée par le **code de récupération du serveur** (même format et même PBKDF2 que le code de compte, AAD `forgechat server-recovery v1|<server_id>`), et `owner_wrapped` = la même pour le propriétaire : AES-GCM(HKDF(ECDH(clé de compte du propriétaire, clé publique du serveur), info `forgechat sk v1|<server_id>|<owner_id>`), scalaire), AAD `sk v1|<server_id>|<owner_id>`. Le code est affiché UNE seule fois (copier / télécharger), régénérable.
- Chaque nouvelle époque d'un salon est AUSSI enveloppée pour la clé publique du serveur (membre virtuel `server:<server_id>` dans l'info et l'AAD de l'enveloppe, table `server_epoch_keys`) ; une fois la clé de serveur créée, le serveur refuse une nouvelle époque de salon sans cette enveloppe (409 SERVER_KEY_REQUIRED) ou pour une autre clé. Historique : `server_missing` (§10) fait compléter par les membres en ligne les époques qu'ils détiennent ; l'événement `SERVER_KEY` les prévient à la création.
- Routes : `GET /servers/:id/e2e/server-key` (membre : clé publique ; propriétaire : aussi `recovery` et `owner_wrapped`), `PUT /servers/:id/e2e/server-key` (création, propriétaire, 409 SERVER_KEY_EXISTS), `PUT …/server-key/recovery` (nouveau code), `PUT …/server-key/owner` (ré-enveloppe pour le propriétaire actuel, après un transfert ou un changement de clé de compte), `GET /servers/:id/e2e/recovery` (propriétaire seulement : toutes les enveloppes d'époques pour la clé du serveur, par salon).
- « Récupérer le contenu du serveur » : l'appli du propriétaire ouvre la clé du serveur (par sa clé de compte, sinon par le code, puis la ré-enveloppe pour lui), ouvre toutes les époques de tous les salons et déchiffre les messages SUR L'APPAREIL pour les lire ou les exporter (JSON / texte) ; rien n'est renvoyé en clair à la plateforme.
- Transfert de propriété : la requête de transfert porte `server_key_owner_wrapped` = clé du serveur ré-enveloppée par l'ancien propriétaire pour le nouveau (ECDH clé du serveur ↔ clé de compte du nouveau, même formule) ; à défaut, le nouveau propriétaire saisit le code de récupération.
- Limite : un membre qui crée une époque pourrait déposer une enveloppe de serveur invalide (le serveur ne peut pas la vérifier) ; l'époque resterait alors illisible pour la récupération, pas pour les membres. Une enveloppe valide déjà déposée n'est jamais remplacée.

## 12. Chiffrement obligatoire et contenu des serveurs jamais purgé (2026-10-07)

Décisions du propriétaire de la plateforme, non négociables : (1) le chiffrement de bout en bout est **obligatoire et automatique**, sans réglage pour s'en passer, pour toutes les conversations (MP, groupes, salons, fils, forums, sondages) et tous les appels ; (2) le contenu des serveurs n'est **jamais purgé** ; (3) l'ancien contenu en clair des serveurs est **rechiffré par les applis**.

### Clé de compte
- Créée automatiquement à l'inscription et à la connexion avec le mot de passe saisi (déjà le cas, §3) ; seule l'étape « code de récupération noté » reste à l'écran.
- Compte sans clé sur l'appareil et sans mot de passe en mémoire (session déjà ouverte) : écran **bloquant** (création ou déverrouillage) ; plus de « Plus tard » (`fc_e2e_later` retiré sur le web, `prompt` ne se referme plus sur mobile). Seule autre issue : « Me déconnecter ».

### Serveur
- Tout texte en clair d'un utilisateur est refusé (400 `PLAINTEXT_REFUSED`) dans les MP, groupes, salons, fils, forums, sondages, messages programmés et transferts, même si un membre n'a pas encore de clé. Exceptions conservées : bots (route `Bot <token>`), webhooks, flux, annonces suivies, messages système et commandes de bot enregistrées (marqués `unencrypted`). Pièces jointes seules (sans texte) : inchangé ici, leur chiffrement est l'étape 4.
- Un membre sans clé ne reçoit simplement pas l'enveloppe : l'époque d'un MP/groupe est créée pour les seuls membres munis d'une clé (`covers` sur les membres munis d'une clé, inchangé) ; `GET …/keys` renvoie `missing` pour **tous** les types de conversation (avant : salons seulement), l'appli d'un détenteur complète dès qu'il a créé sa clé (au chargement de la conversation, une fois par minute au plus), en plus de `KEY_REQUEST`. `encrypt` vaut « j'ai une clé ».
- Appels : `e2ee: true` toujours (`media_e2ee` supprimé). Un membre sans clé ne rejoint pas : son appli refuse de se connecter (« Crée ou déverrouille ta clé de chiffrement pour écrire ou appeler ici. »).
- Renommage d'un fil : `PATCH …/threads/:id {title_enc}` seulement (titre chiffré avec la portée et le `client_id` du fil, auteur = créateur du fil) ; un `title` en clair est refusé.
- Purge J+30 des salons (`e2e_channel::purge_legacy`) **supprimée** ; celle des MP et groupes (`e2e_conv::purge_legacy`) gardée. `legacy_messages` (MP/groupes) ne demande plus que tous les membres aient une clé.

### Rechiffrement de l'ancien contenu des serveurs (`server/src/handlers/e2e_legacy.rs`)
- Éléments : `message`, `thread_message`, `forum_reply`, `forum_post`, `thread_title` (`{t}`, portée du fil, id client = `client_id` du fil), `poll` (`{t: question, o: options}` dans l'ordre de `position`, portée `poll:<nouvel id client>` ; options vidées et aperçu `📊 …` du message lié effacé). Exclus : bots, webhooks (`webhook_display_name`, dont l'historique importé de Discord), types autres que `default` (flux, annonces suivies, sondage, système).
- `GET /e2e/legacy/channels` : mes anciens textes, partout où je vois encore le salon (auteur).
- `GET /e2e/legacy/channels/:channel_id?after=<uuid>&limit=` : à l'ouverture d'un salon (et d'un forum) ; tous les anciens textes si l'appelant est propriétaire, ADMINISTRATOR ou MANAGE_MESSAGES, sinon les siens. Curseur par identifiant : un échec est sauté et repris à la prochaine ouverture.
- `GET /e2e/legacy/servers/:server_id?after=<uuid>&limit=` : propriétaire seulement, tout le serveur ; son appli le parcourt en arrière-plan une fois par session (web : pastille discrète « Chiffrement de l'historique du serveur… N éléments »), reprise naturelle après interruption (ce qui est fait n'est plus listé).
- `PUT /e2e/legacy/channel/:item/:id {enc, client_msg_id}` : par l'auteur, ou par le propriétaire / un modérateur pour le texte d'autrui (sinon 403) ; l'appelant doit voir le salon ; époque courante exigée ; **une seule fois** (`enc` NULL → `enc`, sinon 409 NOT_LEGACY) ; historique d'éditions et copie des enregistrés effacés. **Sécurité** : le serveur ne peut pas vérifier que le chiffré correspond au texte d'origine, d'où la restriction aux modérateurs ; l'AAD garde l'**auteur d'origine** (une appli qui chiffrerait sous son propre identifiant produirait un message illisible, jamais un faux attribué) ; journal serveur sans contenu (`target: e2e_audit`, acteur, auteur, salon, élément) pour chaque rechiffrement du texte d'autrui.
- Applis : `sealBody(…, { author })` ; `completeChannelKeys` lance le rechiffrement du salon ; `reencryptServer` côté propriétaire (web `ServerReencrypt` dans `ChannelPage`, mobile `ChannelLock`).

### Ordre de déploiement
Le serveur refuse désormais ce que les anciennes applis envoient (texte en clair d'un membre sans clé, renommage de fil en clair) : **publier d'abord les applis mobile et bureau à jour** (et laisser le temps aux mises à jour), **puis** déployer le serveur, qui sert en même temps le web à jour. Aucune migration de base n'est nécessaire.

### Limites
- Un modérateur malveillant peut remplacer l'ancien texte en clair d'un autre membre par autre chose (limite inhérente, journalisée) ; pas un message déjà chiffré.
- L'historique importé de Discord et les messages de webhooks restent en clair (non rechiffrables : pas d'auteur humain).
- Mobile : pas d'indicateur d'avancement chez le propriétaire ; pas de renommage de fil (il n'existait pas).
- Pièces jointes : chiffrées à l'étape 4 (branche séparée) ; tant qu'elle n'est pas fusionnée, un fichier joint seul n'est pas refusé.
