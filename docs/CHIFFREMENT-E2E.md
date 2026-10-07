# Chiffrement de bout en bout — conception (2026-10-07)

Demande de Momo : **tout chiffré de A à Z, le serveur (et son administrateur) ne doit jamais pouvoir lire une conversation**, avec une **clé de récupération** comme Forge Audio. Choix validés : salons de serveur chiffrés (fonctions refaites côté appli), historique en clair rechiffré par les applis puis purgé, vocal/appels/écran chiffrés de bout en bout.

## 1. Modèle de menace
- Protégé : lecture de la base, des fichiers, des journaux, de la mémoire du serveur ; administrateur du VPS ; fuite de sauvegarde.
- Non protégé (limite assumée, dite dans la politique de confidentialité) : un serveur **modifié activement** qui servirait un client web piégé ou mentirait sur la liste des membres / les clés publiques. Atténuations : codes de sécurité vérifiables entre deux personnes, alerte « la clé de X a changé », applis mobiles/bureau signées (le code ne vient pas du serveur).
- Métadonnées visibles du serveur (nécessaires au fonctionnement) : qui parle dans quel salon et quand, noms des serveurs/salons, pseudos/avatars, réactions (emoji), identifiants des personnes mentionnées (pour notifier), tailles des fichiers.

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

## 6. Historique existant (rechiffrement puis purge)
- Le serveur garde les anciens messages en clair marqués `legacy`.
- L'appli de **l'auteur** rechiffre en arrière-plan ses anciens messages (par lots) dès qu'elle a la clé de conversation : `PUT /messages/:id/encrypt {enc}` accepté seulement si le message est encore `legacy` et l'appelant en est l'auteur → le serveur écrase le texte (UPDATE puis VACUUM programmé).
- À J+30 du déploiement, tout texte `legacy` restant est purgé (remplacé par « message ancien supprimé »), journalisé en nombre seulement.

## 7. Déploiement sans casse
- Serveur compatible deux modes pendant la transition ; une conversation passe en mode chiffré dès que ses membres ont une clé de compte. Anciennes applis : « Ce message est chiffré : mets à jour ForgeChat » (jamais d'erreur).
- Mises à jour mobile/bureau publiées AVANT d'activer l'obligation côté serveur ; version minimale imposée ensuite.

## 8. Étapes
1. Primitives + vecteurs communs + clé de compte (création, mot de passe, code de récupération, changement de mot de passe, oubli) — web, mobile, serveur.
2. MP 1:1 et groupes chiffrés (texte), refus du clair côté serveur pour ces conversations, rechiffrement de l'historique des MP.
3. Salons de serveur : clés par époque, demandes de clés, rotation, permissions ; mentions en métadonnées ; recherche locale ; AutoMod côté appli.
4. Fichiers chiffrés (web + mobile, flux par blocs).
5. Vocal/appels/écran E2EE (LiveKit).
6. Purge J+30, pages légales, codes de sécurité, tests de bout en bout (deux comptes, trois appareils, rotation).

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
- Envoi/édition : `enc` + `client_msg_id` ; clair refusé si tous les membres ont une clé (400 `PLAINTEXT_REFUSED : …phrase…`), époque périmée ou rotation en attente : 409 EPOCH_STALE. Départ/exclusion d'un groupe : `rotate_needed`, enveloppes du partant supprimées.
- Purge horaire : 30 jours après `e2e_rollout.started_at`, le clair des messages ANTÉRIEURS au déploiement devient NULL + `purged` (nombre seul journalisé). Les messages en clair postérieurs (membre sans clé, transition) ne sont pas purgés ; ils sont rechiffrés par leur auteur dès que tous ont une clé.
- Recherche serveur : ne trouve plus les messages chiffrés (pas de texte) ; les applis cherchent dans les messages déchiffrés. Signalement et transfert d'un MP chiffré : texte fourni par l'appli (`content`). Traduction : impossible (404). Messages enregistrés : pas de copie du texte pour un MP chiffré.
- Push serveur (Expo, Web Push) : corps « Message chiffré » ; l'aperçu n'est déchiffré que par l'appli ouverte ou le mode « sans Google ».
- Anciennes routes de l'essai précédent (`/dms/:id/e2e`, `/users/me/pubkey`, `/users/:id/pubkey`) retirées ; tables `user_pubkeys` et `dm_e2e_messages` laissées en place (à supprimer après accord).

### Anciennes applis
- Web : servie par le serveur, toujours à jour au rechargement.
- Mobile/bureau d'avant cette étape : un message chiffré arrive avec `content = null` et s'affiche comme une bulle vide (auteur et heure, sans texte, aucune erreur). L'envoi de texte dans une conversation dont tous les membres ont une clé échoue avec le message du serveur « PLAINTEXT_REFUSED : cette conversation est chiffrée de bout en bout, mets à jour ForgeChat pour y écrire. ». Tant qu'un membre n'a pas de clé (appli ancienne jamais connectée avec la nouvelle version), la conversation reste en clair.

## 10. Étape 5 réalisée : vocal, appels, caméra, partage d'écran

### Clé de média
- `clé de média = HKDF-SHA256(clé de conversation de l'époque, sel vide, "forgechat media v1|<conv>|<epoch>", 32 o)`, encodée en base64url ; `<conv>` = `dm:<id>`, `group:<id>` ou `channel:<id du salon vocal>`.
- Cette **chaîne** est donnée à LiveKit, qui en dérive la clé AES-GCM des trames par PBKDF2 (sel `LKFrameEncryptionKey`) : c'est le seul chemin de dérivation commun au worker web, au FrameCryptor natif du mobile et au SDK Rust (le chemin HKDF de LiveKit n'existe que sur le web).
- Index de clé = `époque mod 16` (anneau de 16 clés). Clé partagée par tous les participants, aucun ratchet automatique (`ratchetWindowSize 0`, `failureTolerance -1`) : une trame illisible ne fait jamais jeter la bonne clé.
- Nouvelle époque pendant l'appel (départ d'un membre puis rotation, événement `E2E_KEYS`) : chaque appli relit l'époque courante, pose la nouvelle clé à son index et chiffre aussitôt avec ; les trames encore à l'ancien index restent lisibles (clé gardée dans l'anneau). Rejoindre un appel crée l'époque si besoin (première fois, rotation en attente), comme l'envoi d'un message (`currentKey`).
- Vecteur commun `media` dans `docs/e2e-vectors.json` (web `scripts/e2e.test.mjs`, mobile `__tests__/e2e-crypto.test.ts`), recoupé avec une implémentation HKDF indépendante (Python).
- Chiffrés : micro, caméra, partage d'écran et son du partage (toutes les pistes publiées), et les paquets du canal de données LiveKit (option `encryption`, réactions…).

### Serveur
- L'accès LiveKit joint au client porte `e2ee: true` quand la conversation de la salle est chiffrée (même règle que le texte : tous ses membres ont une clé de compte, `e2e_conv::media_e2ee`) : `VOICE_EXISTING_PEERS.livekit` (conversation `channel:<salon>`), `GROUP_CALL_MEDIA.livekit` (`group`), `DM_CALL_ACCEPTED/DM_CALL_MEDIA.livekit` (`dm`, plus `conv_id` : la conversation privée retrouvée par la paire d'utilisateurs, jamais l'id envoyé par le client). Erreur de base : `e2ee: true` (échec propre plutôt que clair).
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

