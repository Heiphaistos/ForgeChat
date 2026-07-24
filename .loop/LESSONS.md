# LESSONS

- Déploiement client ForgeChat : `scp -r dist/* vps:.../dist/` n'efface PAS les anciens chunks hashés (pas de --delete comme rsync, indisponible dans ce shell). Toujours `rm -rf dist/assets/*` sur le VPS avant re-copie, sinon accumulation infinie de bundles obsolètes (30+ fichiers fantômes trouvés ce cycle).
- WebRTC : un sender vidéo désactivé via `replaceTrack(null)` a `sender.track === null` ensuite — un `find(s => s.track?.kind === 'video')` ne le retrouve JAMAIS (kind d'un track null = undefined). Toujours prévoir un fallback `track === null` dans la recherche de sender à réutiliser, sinon chaque cycle off/on crée un nouveau sender (accumulation silencieuse de m-lines).
- Pour distinguer 2 pistes vidéo du même type (caméra vs écran) sans signalisation applicative supplémentaire : leur donner un `stream` (2e argument de `pc.addTrack`) différent à l'émission — le récepteur reçoit alors des `e.streams[0]` avec des `id` (msid) différents dans `ontrack`, suffisant pour les trier.
- ForgeChat a un pipeline CI/CD Forgejo Actions (`.forgejo/workflows/deploy.yml`) qui déploie automatiquement sur push vers `main` (git reset --hard + npm ci + build + docker compose up -d --build). Le scp/chmod manuel vers `/opt/forgechat/client/dist/` fait ce cycle était donc redondant — le push suffit, CI s'en charge en ~1-2 min. Vérifier `ssh vps "cd /opt/forgechat && git rev-parse --short HEAD"` pour confirmer au lieu de scp.
- Ce même pipeline n'a pas de filtre de chemin : il se redéclenche (rebuild Docker complet + npm ci) sur CHAQUE push vers main, même un commit qui ne touche que `.loop/*.md`. Pendant la loop nocturne : committer les checkpoints localement à chaque itération (recovery en cas de coupure) mais ne pousser vers forgejo/github que quand un commit contient un vrai changement de code déployable — pas à chaque mise à jour de CHECKPOINT/JOURNAL seule.
- **CAUSE RACINE de la panne de déploiement du 2026-07-22 (identifiée et réparée)** :
  `npm audit fix` lancé EN LOCAL (Windows, npm 11.6.2) régénère `package-lock.json`
  avec une résolution des `optionalDependencies` différente de celle qu'attend
  `npm ci` sur le VPS (Linux, npm 10.8.2) — le lockfile local omettait des entrées
  (`@emnapi/core`, `@emnapi/runtime`, fallback WASM natif de rollup) que npm 10
  exige pour un `npm ci` strict. Résultat : `npm ci` échouait (EUSAGE) sur CHAQUE
  déploiement suivant, mais le job CI rapportait quand même "success" — l'étape
  `git reset --hard` (avant `npm ci` dans le script) réussissait toujours, donnant
  l'illusion d'un déploiement réussi alors que rien n'était reconstruit derrière.
  **Règle** : après tout `npm install`/`npm audit fix` en LOCAL qui touche
  `package-lock.json`, valider sur le VPS (`ssh ... npm ci`) avant de pousser, ou
  régénérer directement le lockfile depuis le VPS (`ssh ... npm install` puis scp
  le fichier en retour) si un doute existe sur la compatibilité npm/plateforme.
- **Cache Docker menteur (2e occurrence, même piège que l'incident du 16/06)** :
  même après un `git reset --hard` + `npm ci` + `npm run build` réussis, `docker
  compose up -d --build` peut afficher TOUTES les couches `CACHED` (y compris le
  `RUN cargo build --release`) alors que `server/src/*.rs` a réellement changé —
  Docker ne détecte pas toujours l'invalidation même avec le trick `touch` déjà en
  place dans le Dockerfile. Vérifier que le code source sur le VPS contient bien
  les changements attendus (`grep` une chaîne du dernier commit) AVANT de faire
  confiance au résultat `docker compose up -d --build` ; si tout est `CACHED` alors
  que ça ne devrait pas l'être, forcer `docker compose build --no-cache server`
  puis `docker compose up -d`.
- React.memo(MessageRow) peut être cassé silencieusement par des props qui viennent d'AU-DESSUS de MessageList (ChannelPage/DMConversation) : si ces parents passent des fonctions inline (`onReply={(msg) => ...}`), une nouvelle référence est créée à chaque render du parent (countdown, indicateur de frappe, etc.), et si MessageList les relaie brutes à MessageRow (ou les utilise comme dépendance d'un `useCallback` local), la mémoïsation de TOUTE la liste saute. Fix sans toucher le parent : stocker la prop dans une `ref` mise à jour par `useEffect`, exposer un wrapper `useCallback(..., [])` qui lit `ref.current` — référence garantie stable quelle que soit l'instabilité du parent. Toujours vérifier ce pattern après un refactor perf par memoization : auditer TOUTES les props de fonction transmises au composant memoïsé, pas seulement celles définies localement.
- **Sender WebRTC "track === null" comme fallback de réutilisation est ambigu (2026-07-24)** :
  quand on reçoit l'offer d'un pair qui ajoute une piste vidéo (sa caméra), le navigateur
  crée AUTOMATIQUEMENT un transceiver+sender local recvonly correspondant, avec
  `sender.track === null`. Si notre propre code cherche "un sender track===null" pour
  réutiliser un ancien sender caméra désactivé (`replaceTrack(null)` puis plus tard
  `replaceTrack(vt)`), il matche AUSSI ce sender recvonly auto-créé — `replaceTrack()`
  dessus réussit silencieusement (aucune erreur) mais ne déclenche jamais de
  renégociation et un transceiver recvonly n'envoie de toute façon rien : la piste part
  nulle part, l'aperçu LOCAL fonctionne quand même (il vient du MediaStream local, pas du
  sender), donnant un faux positif complet. Fix : suivre explicitement NOS PROPRES
  senders dans une Map par pair (`_camSenders`, même pattern que `_screenSenders` déjà en
  place) au lieu de deviner par l'état `track`. Symptôme namesake : "je vois ma propre
  caméra, l'autre ne voit rien" — testable uniquement si le PAIR active sa caméra AVANT
  nous (sinon le sender recvonly parasite n'existe pas encore et le bug ne se manifeste
  pas). Trouvé via wrapper `RTCPeerConnection` (log tous les events track/negotiation/sdp
  des deux côtés) après qu'un test E2E existant (camera bidirectionnel) se soit mis à
  échouer de façon reproductible.
- **Fix durable du cache Docker menteur (2026-07-22)** : ajout d'un ARG `GIT_SHA` dans
  `server/Dockerfile`, référencé dans la commande du RUN `cargo build --release` (pas
  juste déclaré) -- Docker doit recalculer le cache key de cette layer à chaque fois
  que GIT_SHA change, indépendamment de ce qu'il décide (parfois à tort) pour la layer
  COPY src juste avant. `docker-compose.yml` passe `GIT_SHA: ${GIT_SHA:-unknown}` en
  build arg au service server ; `.forgejo/workflows/deploy.yml` exporte
  `GIT_SHA=$(git rev-parse HEAD)` juste avant `docker compose up -d --build`. Sans ça,
  un `docker compose build --no-cache server` manuel était nécessaire à CHAQUE déploiement
  touchant le serveur pour être sûr que le binaire tournant reflète vraiment le code —
  ce correctif rend l'invalidation fiable sans intervention manuelle.
