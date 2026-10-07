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
3. Salons de serveur : clés par époque, demandes de clés, rotation, permissions ; mentions en métadonnées ; recherche locale ; AutoMod côté appli.
4. Fichiers chiffrés (web + mobile, flux par blocs).
5. Vocal/appels/écran E2EE (LiveKit).
6. Purge J+30, pages légales, codes de sécurité, tests de bout en bout (deux comptes, trois appareils, rotation).
