# Audit de sécurité ForgeChat — 2026-10-12

Périmètre : `server/` (Rust/Axum), `client/` (web), `desktop/` (Tauri), `mobile/` (Expo), CI, Docker, nginx, déploiement,
historique Git des trois dépôts (`ForgeChat`, `Forgechat-ios`, `Forgetchat-android`).
Lecture du code seulement. Versions : srv 3.307.0, web 3.666.0, desktop 3.59.0, mobile 1.33.0 (commit e7dc390).
Non testé : la production (le réseau de l'environnement d'audit bloque forgechat.heiphaistos.org), `cargo audit` et `npm audit`
(non relancés), le snippet nginx `security-headers.conf` (absent du dépôt).

**Bilan : 3 hautes · 8 moyennes · 10 faibles.** Aucune injection SQL, aucune XSS trouvée, aucun secret dans l'historique Git
des trois dépôts. La plupart des failles du 2026-10-10 sont corrigées (tableau en fin de document).

Les deux failles les plus graves (H2, H3) visent la promesse du chiffrement : « le serveur ne doit jamais pouvoir lire ».
Un VPS compromis qui ne fait que **lire** reste aveugle. Un VPS compromis qui **ment activement** peut aujourd'hui lire
tout l'historique des salons, et faire passer des messages en clair pour ceux d'un correspondant, sans que personne ne le voie.

---

## HAUTE

### H1 — Un jeton de rafraîchissement volé ne meurt jamais, et survit à « déconnecter partout »
`server/src/handlers/auth.rs:506-527` (`rotate_refresh_token`, branche « délai de grâce »).

- Un jeton déjà tourné reste accepté 60 s (`rtgrace:<hash>`). Dans cette branche, la clé de grâce est **reposée** pour
  60 s à chaque appel (ligne 527) : en le présentant toutes les 50 s, le même vieux jeton reste valable indéfiniment, et
  chaque appel fabrique un **nouveau** jeton de rafraîchissement valable 30 jours.
- Ces jetons n'ont aucune ligne `user_sessions` (l'`UPDATE … WHERE refresh_token_hash = <ancien>` ne trouve rien) : la
  session de l'attaquant est **invisible** dans « Sessions » et ne peut pas être révoquée seule.
- Le seul garde-fou est « il reste au moins un jeton pour ce compte ». Après « déconnecter partout », un changement ou une
  réinitialisation du mot de passe, la victime se reconnecte : la condition redevient vraie et le vieux jeton revit. La
  clé `rtgrace:` n'est jamais effacée par ces actions, et le jeton d'accès émis a un `iat` postérieur à la révocation.
- Le réemploi d'un jeton tourné n'est jamais traité comme un vol (la RTR classique révoque toute la famille).

Scénario : jeton de rafraîchissement volé (sauvegarde de téléphone, poste partagé, malware). La victime change son mot de
passe : l'attaquant garde l'accès, sans trace dans la liste des sessions.

Correctif : poser `rtgrace:` en `SET NX` seulement sur la branche `DELETE` (jamais la prolonger) ; dans la branche de grâce,
renvoyer le **même** successeur (le mémoriser avec la grâce) au lieu d'en créer un ; refuser la grâce si
`jwtrevoke:<user>` est postérieur à sa création ; supprimer les clés de grâce du compte à la déconnexion globale, au
changement et à la réinitialisation du mot de passe. Au-delà de la fenêtre, un réemploi doit révoquer toutes les sessions.

### H2 — Une fausse « clé de récupération du serveur » reçoit tout l'historique des salons, en silence
`client/src/e2e/conversations.ts:174` et `:447`, `client/src/e2e/keyPins.ts:146` (même code sur mobile).

- La clé publique « du serveur » (§11 de CHIFFREMENT-E2E.md) vient du VPS et n'est signée par personne. Elle est épinglée
  à la première vue (TOFU) **sans aucune action de l'utilisateur**.
- Dès qu'elle apparaît, chaque appli enveloppe la nouvelle époque pour elle, puis complète `server_missing` : **toutes les
  époques passées** qu'elle détient sont ré-enveloppées pour cette clé.
- Un VPS compromis annonce sa propre paire comme « clé du serveur » sur un serveur qui n'en a pas (ou à un appareil neuf,
  qui n'a pas encore d'épingle) : il obtient les clés de tout l'historique des salons, sans membre visible ni alerte.

C'est bien pire que la limite documentée « le serveur peut mentir sur une clé publique » : une fausse clé de membre ne
donne qu'une conversation, celle-ci les donne toutes, rétroactivement.

Correctif : la clé publique du serveur doit être **signée par la clé de compte du propriétaire** (ajouter une clé de
signature Ed25519/ECDSA à la clé de compte), vérifiée contre la clé épinglée du propriétaire ; refuser toute clé non
signée. Afficher à chaque membre « La récupération par le propriétaire est activée » et demander une confirmation
explicite avant de ré-envelopper l'historique (`server_missing`).

### H3 — Le serveur peut injecter des messages en clair au nom d'un correspondant
`client/src/e2e/conversations.ts:373` (`openMessage`), `client/src/components/chat/MessageRow.tsx:227`,
`mobile/src/features/chat/adapters.ts:34,134`.

- Un message sans `enc` mais avec `content` est affiché tel quel. Le badge « non chiffré » dépend du champ `unencrypted`
  **calculé par le serveur**. Le serveur peut donc l'omettre.
- En MP et en groupe, aucun badge n'existe du tout : le serveur ne renvoie jamais `unencrypted` pour ces messages.
- Le chiffrement étant obligatoire (§12), un VPS compromis peut faire dire n'importe quoi à n'importe quel correspondant
  (« voici mon nouveau numéro », « clique ici »), dans une conversation affichée « chiffrée de bout en bout ».

Correctif : calculer `unencrypted = !m.enc && !!m.content` **sur l'appareil**, ignorer le champ du serveur. En MP et en
groupe, où plus aucun envoi légitime n'est en clair, afficher un avertissement net ou masquer ces messages. Même règle
pour `reply_to_content` en clair.

---

## MOYENNE

| # | Faille | Où | Correctif |
|---|---|---|---|
| M1 | **Fuite des liens des messages chiffrés.** Avant de chiffrer, l'appli envoie au serveur la 1re URL du message (`GET /og?url=…`), quel que soit le domaine. Le serveur apprend donc les liens partagés dans les salons « chiffrés », même s'il refuse ensuite l'aperçu. | `client/src/e2e/channels.ts:52` | Filtrer par la liste blanche **avant** l'appel, ou rendre l'aperçu optionnel (désactivé par défaut). |
| M2 | **Pistage des lecteurs par l'aperçu.** L'aperçu est fourni par l'expéditeur dans le contenu chiffré ; `p.image` peut être n'importe quelle URL http(s). Chaque lecteur la charge automatiquement : l'expéditeur obtient l'IP et l'heure de lecture de chacun. | `client/src/components/chat/LinkPreview.tsx:53` (idem mobile), CSP `img-src https:` | Ne charger que des images d'hôtes connus, passer par un proxy du serveur, ou attendre un clic. `referrerPolicy="no-referrer"`. |
| M3 | **Le chiffrement ne vaut que la force du mot de passe face au serveur.** L'enveloppe de la clé privée (`wrapped`, PBKDF2-SHA256 600 000) est stockée sur le serveur. Un VPS compromis l'attaque hors ligne sur GPU. Minimum 10 caractères, imposé par l'appli seulement ; la jauge de robustesse ne bloque rien. | `client/src/e2e/crypto.ts:8`, `authKdf.ts:11` | Argon2id (WASM, ≥ 64 Mio) pour la clé d'enveloppe ; refuser les mots de passe faibles (zxcvbn ≥ 3) ; encourager le code de récupération. |
| M4 | **Commandes de bot envoyées en clair, sur décision du serveur.** Un message commençant par `/nom`, où `nom` figure dans la liste des commandes **fournie par le serveur**, part en clair, sans avertissement. | `client/src/e2e/channels.ts:84` | Afficher « envoyé en clair au bot » avant l'envoi, et ne jamais l'appliquer en dehors d'un salon qui contient vraiment ce bot. |
| M5 | **Bureau : dépôt silencieux de fichiers, sans « Mark of the Web ».** Avec un dossier de téléchargement et « demander où enregistrer » désactivé, `save_file` écrit n'importe quel nom (`.exe`, `.lnk`, `.bat`) sans boîte de dialogue. Aucun fichier enregistré ne porte `Zone.Identifier` : SmartScreen ne prévient pas à l'ouverture d'une pièce jointe piégée envoyée par un autre membre. | `desktop/src-tauri/src/systeme.rs:228,243` | Écrire l'ADS `Zone.Identifier` (ZoneId=3) sous Windows et l'attribut `com.apple.quarantine` sous macOS ; toujours demander pour les extensions exécutables. |
| M6 | **Bureau : la CSP autorise les scripts venant du serveur.** `script-src … https://forgechat.heiphaistos.org` : l'appli signée charge son code localement, mais une injection pourrait charger du JS servi par le VPS, ce qui annule l'intérêt d'une appli signée face à un serveur compromis. `img-src https:` permet aussi le pistage. | `desktop/src-tauri/tauri.conf.json:33` | Retirer le domaine de `script-src` et `style-src` ; restreindre `img-src`. |
| M7 | **iOS : l'IPA installée n'est pas celle qui a été vérifiée.** L'appli vérifie la liste signée, puis passe l'URL à AltStore/SideStore, qui retélécharge le fichier et le re-signe avec le certificat de l'utilisateur. Aucune continuité de signature : le serveur peut servir un autre fichier à ce moment-là. | `mobile/src/features/updates/installer.ts:8` | Télécharger l'IPA dans l'appli, vérifier son SHA-256 signé, puis la remettre à AltStore depuis un fichier local ; sinon le dire clairement à l'utilisateur. |
| M8 | **Déploiement : la branche par défaut de GitHub est la racine de confiance.** `deployer-auto` aligne `/opt/forgechat` sur GitHub toutes les 2 min. Un compte GitHub (ou un jeton) compromis = code exécuté sur le VPS et client web piégé servi à tous (contournement complet du chiffrement pour le web). | `deploy/deploy.sh`, `.forgejo/workflows/deploy.yml` | Ne déployer que des commits ou tags **signés** (`git verify-commit`/`verify-tag` avec une clé épinglée sur le VPS) ; protection de branche et 2FA matérielle sur GitHub. |

---

## FAIBLE

- **Verrouillage de compte** : 10 tentatives / 15 min par e-mail (`auth.rs:372`). Un tiers qui connaît l'adresse bloque la connexion de la victime en continu.
- **Sessions invisibles** : `verify_email` crée un jeton de rafraîchissement sans ligne `user_sessions` (`auth.rs:335`), donc impossible à révoquer seul.
- **Cookies partagés avec les sous-domaines** : `SameSite=Strict` considère tout `*.heiphaistos.org` comme le même site (ghd, forgearchive…). Un envoi `multipart/form-data` (requête « simple », sans pré-vol CORS) depuis un sous-domaine compromis part avec les cookies. Utiliser le préfixe `__Host-` et exiger un en-tête personnalisé sur les routes qui modifient quelque chose.
- **WebSocket** : `DM_READ` et `TYPING` sans limite de débit (`websocket.rs:752,802`), `TYPING_START` vérifie l'appartenance au serveur mais pas `VIEW_CHANNEL`, `THREAD_TYPING` ne vérifie pas que le fil appartient au serveur.
- **Bureau, Linux** : la mise à jour est écrite sous un nom prévisible dans `/tmp` partagé (`updater.rs:636`), sans `O_EXCL`. Un autre compte local peut remplacer le `.deb` vérifié avant `sudo apt install`. Utiliser un dossier temporaire privé (0700, nom aléatoire).
- **Filtre SSRF** : IPv6 incomplet (2002::/16 6to4, ::/96, 64:ff9b:1::/48, fec0::/10) dans `net_guard.rs:41`. Peu exploitable derrière Docker en IPv4 seul.
- **Doc trompeuse sur le stockage local web** : une `CryptoKey` « non extractible » dans IndexedDB l'est pour le JavaScript, pas pour une copie du profil du navigateur (`searchIndex.ts:5`, idem clé de compte). Corriger la promesse « une copie du disque ne livre pas le texte ».
- **Recherche globale d'utilisateurs** : n'importe quel compte voit le statut en ligne et le statut personnalisé de tout le monde (`users.rs:421`).
- **Support à distance (GhostHandDesk)** : la confirmation existe, mais c'est le scénario type de l'arnaque au faux support. Le réserver aux amis, avec un avertissement explicite ; l'exécutable est téléchargé sans vérification de signature (`remoteSupport.ts:26`).
- **Dépôts `Forgechat-ios` (1.8.0) et `Forgetchat-android` (1.15.0)** : très en retard sur `ForgeChat/mobile` (1.33.0), sans la connexion v2 ni les correctifs. Les archiver en lecture seule pour que personne ne les compile.

---

## Suivi de l'audit du 2026-10-10

| Faille d'origine | État constaté |
|---|---|
| H1 limite de connexion contournable | **Corrigé** : plus de remise à zéro par IP, `X-Forwarded-For` ignoré, compteur par compte. |
| H2 mot de passe reçu par le serveur | **Corrigé** : connexion v2 (PBKDF2 + HKDF sur l'appareil) et garde anti-rétrogradation `legacy`. Reste M3. |
| H3 clés publiques non vérifiées | **Corrigé pour les membres** (épinglage, empreinte recalculée, alerte de changement). **Pas pour la clé du serveur** : voir H2 ci-dessus. |
| H4 mise à jour bureau non signée | **Corrigé** : `SHA256SUMS` signé Ed25519 hors CI, clé publique embarquée. |
| H5 CI `contents: write` | **Corrigé** : `contents: read` partout sauf le job `release`, actions épinglées par empreinte. |
| M1 `/users/search` | Corrigé (`for_others`). |
| M2 propriétaire lié à l'e-mail | Corrigé (lié à l'UUID ; inscription avec code de vérification). |
| M3 surcharges de salon | Corrigé (bits limités aux permissions de l'acteur sur le salon). |
| M4 enveloppes empoisonnées | Corrigé (`withheld` contrôlé). |
| M5 corps HTTP sans plafond | Corrigé (`read_capped`). |
| M6 WebSocket après déconnexion | Corrigé (fermeture + revérification toutes les 60 s). |
| M7 TOTP | Corrigé (anti-rejeu, secret chiffré, codes de secours 64 bits hachés). |
| M9 `FORGECHAT_UPDATE_ENDPOINT` | Corrigé (debug seulement). |
| M10 jetons bureau en localStorage | Corrigé (trousseau du système ; repli Linux chiffré 0600, limite documentée). |
| M11 CSP `unsafe-inline`/`unsafe-eval` | Corrigé dans `nginx.conf` (à confirmer en production). |
| M12 déploiement root / TOFU SSH | Partiel : empreinte SSH épinglée, clé à commande forcée. Reste M8. |
| M13 keystore Android | Corrigé (Environment `android-release`, tags seulement). |
| M14 SHA-256 APK/IPA | Android : la signature APK du système fait foi. iOS : voir M7. |
| Faibles (WS sans plafond, JWT secret, `/uploads` public, TURN statique, Redis fail-open…) | Corrigés. |

---

## Ordre conseillé

1. **H1** (jetons de rafraîchissement) : petit correctif serveur, impact immédiat.
2. **H3** (badge calculé sur l'appareil) : quelques lignes web et mobile.
3. **H2** (clé du serveur signée par le propriétaire) : changement de protocole, web + mobile + serveur + vecteurs de test.
4. **M1, M2, M4** : fuites de métadonnées du chiffrement.
5. **M5, M6, M7** : applis signées.
6. **M3, M8** : durcissements de fond (Argon2id, déploiement signé).

« 100 % sécurisé » n'existe pas. L'objectif réaliste : un serveur compromis ne doit pouvoir ni lire, ni falsifier
**sans être vu**. Après H2, H3 et M1-M4, la limite restante sera celle déjà assumée : le client **web** est servi par
le serveur. Pour les conversations sensibles, il faut utiliser les applis bureau et mobile signées.

---

## Correctifs appliqués (branche `ccr-0cffbb8b-8y1c4w`, 2026-10-12)

| # | État | Ce qui a changé |
|---|---|---|
| H1 | **Corrigé** | La grâce rend le **même** successeur (chiffré dans Redis par une clé tirée de l'ancien jeton), n'est jamais prolongée (`SET NX`), tombe dès que la session est fermée ou le compte révoqué. `verify_email` ouvre une session visible. Test sur vraie base : `refresh_grace_db`. |
| H2 | **Corrigé** | Clé de récupération signée par la clé de compte du propriétaire (ECDSA P-256, vérifiée aussi par le serveur, migration 122). Acceptée sans question seulement si le signataire est déjà épinglé sur l'appareil ; sinon acceptation explicite, rien (ni historique) n'est enveloppé avant. Web, mobile, serveur ; vecteur `serverKeySig`, test sur vraie base `server_key_signature_db`. |
| H3 | **Corrigé** | « Non chiffré » calculé sur l'appareil (`openMessage`, `plainFields`), jamais d'après le serveur ; alerte rouge « authenticité non garantie » en MP et groupe. |
| M1 | **Corrigé** | Liste blanche `previewAllowed` vérifiée sur l'appareil avant tout `/og` ; les groupes web ne demandent plus `/og` pour un message déchiffré. |
| M2 | **Corrigé** | Plus d'image dans un aperçu fourni par l'expéditeur ; `referrerPolicy="no-referrer"`. |
| M3 | **Partiel** | 12 caractères, pas de bases courantes ni pseudo/e-mail, 3 sortes de caractères sous 16 caractères (web, mobile, y compris réinitialisation mobile). Reste : Argon2id à la place de PBKDF2. |
| M4 | **Corrigé** | Confirmation explicite avant d'envoyer une commande de bot en clair (une fois par commande et par session). |
| M5 | **Corrigé** | `Zone.Identifier` (Windows) / `com.apple.quarantine` (macOS) sur chaque fichier enregistré ; jamais d'exécutable déposé sans boîte « Enregistrer sous ». |
| M6 | **Corrigé** | Le domaine du serveur est retiré de `script-src` et `style-src` de la CSP du bureau. |
| M7 | Ouvert | IPA iOS : à télécharger et vérifier dans l'appli avant AltStore. |
| M8 | Ouvert (infra) | Déploiement : vérifier `git verify-commit`/`verify-tag` sur le VPS avant d'aligner `/opt/forgechat` ; protection de branche et 2FA matérielle sur GitHub. |
| Faibles | **Corrigés** : verrouillage de compte (limite par compte **et** adresse, plafond 100/h par compte), sessions invisibles, CSRF entre sous-domaines (contrôle `Origin`/`Sec-Fetch-Site` des écritures par cookie, et `accounts/stash`), WebSocket (`VIEW_CHANNEL`, fil vérifié, limites de débit), dossier temporaire privé des mises à jour Linux, plages IPv6 du filtre SSRF. Recherche globale d'utilisateurs : présence et statut personnalisé masqués hors amis et serveurs communs (test `security_search_hides_strangers_presence`). Formulation sur IndexedDB corrigée. **Ouverts** : support à distance réservé aux amis, archivage des dépôts iOS/Android périmés. |

Vérifié : `cargo test` serveur (174 tests, plus 21 tests sur vraie base PostgreSQL + Redis), `tsc`, `eslint` et tests `node --test` du web, `tsc` et `jest` du mobile (635 tests). Le crate bureau n'a pas pu être compilé ici (libwebrtc exige clang 21) : les fonctions modifiées ont été compilées et testées à part.
