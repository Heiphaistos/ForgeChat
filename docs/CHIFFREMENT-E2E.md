# Chiffrement de bout en bout — conception (2026-10-07)

Demande de Momo : **tout chiffré de A à Z, le serveur (et son administrateur) ne doit jamais pouvoir lire une conversation**, avec une **clé de récupération** comme Forge Audio. Choix validés : salons de serveur chiffrés (fonctions refaites côté appli), historique en clair rechiffré par les applis puis purgé, vocal/appels/écran chiffrés de bout en bout.

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
- LiveKit E2EE (insertable streams / frame cryptor) avec un fournisseur de clé externe : clé de média = HKDF(clé de conversation de l'époque courante, info "forgechat media v1|<conv>|<epoch>"). Nouvelle époque = nouvelle clé (ratchet LiveKit sur changement).
- Web : `livekit-client` E2EE (worker) ; mobile : `@livekit/react-native` E2EE (à vérifier sur la version installée). Un participant sans E2EE ne peut pas rejoindre un salon chiffré (message « mets à jour l'appli »).

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
3. Salons de serveur : clés par époque, demandes de clés, rotation, permissions ; mentions en métadonnées ; recherche locale ; AutoMod côté appli ; clé de récupération du serveur pour son propriétaire (ajout du 2026-10-07). Réalisée : §10 et §11.
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

## 10. Étape 3 réalisée : salons de serveur chiffrés (texte)

### Membres autorisés et époques
- Conversation `channel:<channel_id>` (kind `channel` dans les routes `/e2e/conversations/:kind/:id/...`), même mécanisme d'époques et d'enveloppes que les MP (§9). Un fil et une publication de forum utilisent la clé de leur salon.
- Membres autorisés = membres du serveur (hors bots) qui VOIENT le salon : rôles + @everyone + surcharges du salon (même règle que la diffusion `channel_audience_among`). Propriétaire et administrateurs voient tout.
- Les droits changent à beaucoup d'endroits (départ, exclusion, bannissement, retrait de rôle ou de permission, surcharge, salon rendu privé…) : **approche paresseuse**, aucun événement à émettre. À chaque envoi chiffré (et à chaque lecture des clés), le serveur vérifie que tous les détenteurs de l'époque courante voient encore le salon ; sinon il marque `rotate_needed` et répond 409 EPOCH_STALE. L'émetteur recharge, crée l'époque suivante pour les membres restants et renvoie. Un ancien membre ne lit plus rien (403 sur les clés et les messages) et n'a pas la clé des époques suivantes.
- Gain d'accès (arrivée, rôle, permission) : `GET …/keys` d'un salon renvoie `missing` (membres munis d'une clé auxquels l'époque courante manque, 200 au plus) ; l'appli d'un membre qui a les clés (à l'ouverture du salon et après un envoi, au plus une fois par minute) les enveloppe pour eux, toutes époques connues (historique visible). Le nouveau venu qui ne peut pas ouvrir un message demande aussi les clés (`KEY_REQUEST`, envoyé à 20 détenteurs connectés au plus).
- Grands serveurs : une nouvelle époque de salon est créée avec l'enveloppe du créateur (+ un premier lot) ; le reste est distribué par lots de 200 (redistribution `create: false`). O(n) enveloppes par époque. `GET …/members` est paginé (`?after=<uuid>`, 1000 par page, salons : seulement les membres munis d'une clé ; `?member=<uuid>` pour un seul).
- `GET …/keys` d'un salon ajoute `encrypt` (j'ai une clé : il faut chiffrer), `missing`, `server_key` (clé de récupération du serveur, §11) et `server_missing` (mes époques pas encore enveloppées pour elle).

### Transition : on chiffre dès que l'émetteur a une clé
Contrairement aux MP (clair permis tant qu'un membre n'a pas de clé), un salon chiffre **dès que l'auteur a une clé de compte** : sur un serveur public avec beaucoup de membres sans clé, attendre bloquerait tout. Les membres sans clé de compte voient « 🔒 Message chiffré : crée ta clé de chiffrement pour le lire » ; ils en créent une à leur prochaine connexion avec une appli à jour (écran de clé) et reçoivent alors les époques (`missing`, `KEY_REQUEST`). Un membre sans clé (appli ancienne) peut encore écrire en clair ; ce message est marqué `unencrypted` (« non chiffré ») et sera rechiffré par son auteur quand il aura une clé.

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
- Purge horaire, 30 jours après `channels_started_at` : le clair ANTÉRIEUR restant devient NULL + `purged` (messages, fils, forums, titres de fils, sondages). Gardés (non chiffrés par nature) : webhooks, bots, flux, annonces suivies et **historique importé de Discord** (auteur affiché par `webhook_display_name`). Nombre seul journalisé.
- Suppression d'un salon : ses enveloppes sont supprimées.

### Applis (web et mobile)
- Modules cœur : `e2e/conversations.ts` (kind `channel`, `sealBody` avec portée, distribution par lots, `completeChannelKeys`, rechiffrement de l'historique des salons), `e2e/channelText.ts` (mentions en métadonnées, AutoMod, première URL ; fonctions pures testées à l'identique des deux côtés), `e2e/serverKey.ts` (§11).
- Aperçus de liens : l'expéditeur demande `/og` (le serveur voit l'URL un instant, ne la stocke pas) et met l'aperçu dans le contenu chiffré ; les destinataires ne demandent rien au serveur pour un message chiffré.
- Écrans branchés (web et mobile) : messages, réponses, éditions, épingles, fils (titres compris), forums et salons médias, sondages, messages programmés, enregistrés, mentions, recherche locale, transfert (rechiffré pour un salon cible chiffré), signalement, badge « non chiffré », cadenas d'en-tête, onglet « Chiffrement » des réglages du serveur (§11), invitation du propriétaire, transfert de propriété.
- Limites connues : renommer un fil chiffré est masqué (le serveur ne renomme qu'en clair) ; l'AutoMod de l'appli ne vérifie pas les options de sondage ni le titre d'une publication, ni l'édition sur mobile ; un message programmé chiffré ne notifie pas ses mentions (le serveur le recopie sans métadonnées) ; une publication de forum chiffrée n'a pas d'aperçu de lien ; la récupération du serveur ne couvre que les messages des salons (pas les fils, forums ni sondages) et l'export mobile passe par la feuille de partage (taille bornée, export salon par salon au-delà).

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
