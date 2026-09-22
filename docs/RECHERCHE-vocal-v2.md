# Recherche : vocal / vidéo / stream v2 (passage à un SFU)

Date : 2026-09-22. Recherche web en lecture seule. Chaque affirmation porte sa source ; ce qui n'a pas pu être vérifié est marqué **[NON VÉRIFIÉ]**.

## 0. En bref

- Les clones de Discord auto-hébergés récents ont tous quitté le mesh P2P pour un **SFU**. Element Call (Matrix) et Stoat (ex-Revolt) ont retenu **LiveKit**, Mattermost a écrit son propre SFU (`rtcd`, sur Pion) et Rocket.Chat délègue à des fournisseurs externes (Jitsi, BigBlueButton, Pexip, Google Meet).
- **LiveKit à jour au 2026-09-22** : serveur `v1.13.7` (14/09/2026), image `livekit/livekit-server:v1.13.7` ; SDK JS `livekit-client` `2.22.3` (07/09/2026). Tout est vérifié par l'API GitHub, Docker Hub et npm.
- **Jeton** : un JWT **HS256** signé avec le secret de l'API, `iss` = clé d'API, `sub` = identité, avec un objet `video` qui porte les permissions. Il se génère en Rust avec `jsonwebtoken`, sans SDK. Le code est au §2.4.
- **Bloquant côté Linux** : la WebKitGTK livrée par les distributions a très probablement **WebRTC désactivé à la compilation** (`RTCPeerConnection` indéfini). Cela vaut pour tout WebRTC dans Tauri sous Linux, SFU ou non. Détail au §5.4.
- **Fenêtres détachées dans Tauri** : `on_new_window` existe depuis **Tauri 2.8.0**. Avec `window_features(features)`, la fenêtre créée reste liée à celle qui l'a ouverte (`window.opener`). Partager un `MediaStream` entre fenêtres de même origine devient alors plausible, mais c'est **[NON VÉRIFIÉ dans WebView2]**. Le plan B, fiable partout, est que chaque fenêtre ouvre sa propre connexion au SFU.
- **Hypothèse sur la panne en réseau local** (déduite, pas testée) : un mesh P2P entre deux PC du même réseau dépend des candidats mDNS `.local`, que Chromium utilise pour masquer les IP locales. Il dépend aussi du « hairpin NAT » de la box et d'un TURN effectivement utilisé. Avec un SFU sur le VPS, chaque client se connecte uniquement à l'IP publique du VPS : ce cas d'échec disparaît.

---

## 1. Ce que font les autres

### 1.1 Element Call / MatrixRTC (LiveKit)
- Architecture : client Element Call, puis **lk-jwt-service** (« MatrixRTC Authorization Service »), puis le **SFU LiveKit**. Le lien entre le client Matrix et LiveKit passe par le homeserver, conformément à **MSC4195** (« MatrixRTC using LiveKit backend »).
- Découverte : `.well-known/matrix/client` contient `"org.matrix.msc4143.rtc_foci": [{ "type": "livekit", "livekit_service_url": "https://matrix-rtc.domain.tld/livekit/jwt" }]`.
- Flux d'authentification (mode autonome, historique) : le client obtient un **jeton OpenID Matrix** auprès de son homeserver, puis appelle `POST /sfu/get` (ou `/get_token`) sur lk-jwt-service. Le service vérifie l'identité auprès du homeserver et renvoie `{url, jwt}` LiveKit. Nouveau mode : lk-jwt-service fonctionne en **application service** du homeserver (MSC4502/MSC4512), avec un proxy sur `/rtc/livekit`.
- Contrôle d'accès : seuls les utilisateurs « full-access » (`LIVEKIT_FULL_ACCESS_HOMESERVERS`) peuvent **créer** une salle. Les autres ne peuvent que rejoindre une salle existante. Cela exige `room.auto_create: false` dans la configuration LiveKit, sinon n'importe quel jeton valide crée des salles.
- Webhooks : le SFU envoie ses événements vers `/sfu_webhook` du service, signés avec une clé d'API connue du SFU. Ils servent à gérer les « delayed leave » (MSC4140), c'est-à-dire la présence exacte quand un client disparaît sans prévenir.
- Routage nginx recommandé, sur un seul nom d'hôte : `/livekit/jwt/` vers `:8080` et `/livekit/sfu/` vers `:7880`, avec WebSocket (`Upgrade`/`Connection "upgrade"`), `proxy_buffering off` et `proxy_read_timeout 120`. L'extrait est au §2.3.
- Versions : element-call `v0.26.0` (15/09/2026). Deux modes MatrixRTC coexistent : `compatibility` (événements d'état) et `matrix_2_0` (événements « sticky », MSC4354).
- Chiffrement de bout en bout (E2EE) : Element Call utilise l'E2EE LiveKit (insertable streams), avec des clés distribuées par Matrix. **[Mécanisme exact de distribution NON VÉRIFIÉ ici]**
- Sources :
  - https://github.com/element-hq/lk-jwt-service (README)
  - https://github.com/element-hq/element-call/blob/main/docs/self_hosting.md
  - https://github.com/element-hq/element-call/blob/main/docs/matrix_rtc_modes.md
  - https://github.com/matrix-org/matrix-spec-proposals/pull/4195

**Pourquoi LiveKit** (d'après les choix observés) : SFU open source (Apache-2.0), SDK clients maintenus, simulcast, dynacast et TURN intégré. L'autorisation se fait par un simple JWT, ce qui permet de garder l'identité applicative hors du SFU.

### 1.2 Rocket.Chat
- Rocket.Chat n'a pas de SFU maison. Des **apps de visioconférence** dans sa marketplace s'appuient sur des fournisseurs externes : **Jitsi, BigBlueButton, Pexip, Google Meet**. Certaines fonctions, comme la sonnerie et l'historique des appels dans le canal, sont réservées à l'édition Enterprise.
- Sources :
  - https://docs.rocket.chat/docs/rocketchat-conference-call
  - https://developer.rocket.chat/docs/video-conferencing-apps

### 1.3 Jitsi Videobridge
- SFU en Java (JVB), piloté par Jicofo avec une signalisation XMPP (Prosody). C'est une pile lourde, de 4 services au moins. Elle est pertinente pour de la visio de type réunion, beaucoup moins pour s'intégrer dans une app existante (le chemin standard passe par une iframe ou `lib-jitsi-meet`).
- **[Détails de version NON VÉRIFIÉS : l'API GitHub n'a pas renvoyé de release « latest » pour jitsi/jitsi-videobridge]**

### 1.4 Stoat (ex-Revolt)
- Revolt a été renommé **Stoat** en octobre 2025 (organisation GitHub `stoatchat`). La voix et la vidéo passent désormais par **LiveKit**. La configuration LiveKit est arrivée dans le dépôt d'auto-hébergement le 18/02/2026 et elle est **obligatoire** pour la voix et la nouvelle app web.
- Ports ouverts dans leur déploiement : `7881/tcp` et `50000-50100/udp`.
- Sources :
  - https://github.com/stoatchat/self-hosted
  - https://en.wikipedia.org/wiki/Stoat_(software)

### 1.5 Spacebar (compatible Discord)
- Spacebar reproduit le protocole Discord : une passerelle vocale en WebSocket plus un **SFU**. Des implémentations existent sur **mediasoup** et sur **Pion**. Le support WebRTC est **expérimental** et l'UDP natif de Discord (clients desktop officiels) n'est pas supporté.
- Sources :
  - https://docs.spacebar.chat/contributing/reverse-engineering/voice/
  - https://docs.spacebar.chat/contributing/reverse-engineering/voice/sfu/

### 1.6 Mattermost Calls (rtcd)
- Mattermost a écrit son **propre SFU en Go sur Pion** (`github.com/pion/webrtc/v4 v4.2.6` dans `go.mod`). Il fonctionne soit intégré au plugin Calls, soit en service séparé **`rtcd`** (API HTTP, WebSocket et SFU).
- Tout le média passe par **un seul port** : `ice_port_udp = 8443` et `ice_port_tcp = 8443`, plus `ice_host_override` pour l'IP publique.
- Un appel donné tient sur un seul nœud `rtcd`. Plusieurs nœuds servent seulement à la redondance.
- Sources :
  - https://github.com/mattermost/rtcd (`config/config.sample.toml`, `go.mod`)
  - https://docs.mattermost.com/administration-guide/configure/calls-rtcd-setup.html

### 1.7 Synthèse des choix

| Projet | Média | Auth vers le SFU | Port média |
|---|---|---|---|
| Element Call | LiveKit | JWT émis par lk-jwt-service après OpenID | 7881/tcp + plage ou mux UDP |
| Stoat | LiveKit | JWT émis par l'API Stoat | 7881/tcp + 50000-50100/udp |
| Mattermost | rtcd (Pion, maison) | jeton interne | 8443 UDP+TCP (un seul port) |
| Rocket.Chat | Jitsi, BBB, etc. (externe) | apps | selon le fournisseur |
| Spacebar | mediasoup ou Pion (expérimental) | protocole Discord | — |

Pour ForgeChat, le chemin le plus court est celui de Stoat et d'Element Call : **LiveKit plus des JWT émis par le serveur Axum existant**. Un service de jetons séparé n'a pas de raison d'être, puisque le serveur Axum connaît déjà les utilisateurs et les salons.

---

## 2. Auto-hébergement LiveKit

### 2.1 Version et image
- Serveur : **v1.13.7** (publiée le 2026-09-14). Précédentes : v1.13.6 (26/08), v1.13.5 (31/07), v1.13.4 (18/07). Source : API GitHub `livekit/livekit/releases`.
- Image Docker : **`livekit/livekit-server`**, avec les tags `v1.13.7`, `v1.13`, `latest` et `master` (Docker Hub). Épingler `v1.13.7`, jamais `latest` (règle Docker/VPS).
- En Docker, LiveKit recommande le **réseau hôte** (`--network host`) : « If running in a Dockerized environment, host networking should be used for optimal performance. » Source : https://docs.livekit.io/transport/self-hosting/deployment/
- Génération des clés : `livekit-server generate-keys`. Il existe aussi un mode `--dev` avec les clés `devkey`/`secret`, **jamais en production**. **[Commande exacte NON revérifiée dans la doc 2026]**

### 2.2 `livekit.yaml` minimal pour un seul nœud (d'après `config-sample.yaml` sur master)

```yaml
port: 7880                 # API + WebSocket de signalisation (derrière nginx TLS)
bind_addresses: ["127.0.0.1"]   # signalisation accessible seulement via nginx [clé à vérifier dans config-sample]
log_level: info
rtc:
  tcp_port: 7881           # ICE/TCP de secours, NE PEUT PAS être derrière un load balancer ou du TLS
  # Option A : plage UDP
  port_range_start: 50000
  port_range_end: 60000
  # Option B : mux UDP sur un seul port. Ne pas définir port_range_* dans ce cas.
  # udp_port: 7882          # ou une plage courte "7882-7892" (>= nombre de vCPU recommandé)
  use_external_ip: true    # découvre l'IP publique par STUN
  # node_ip: 212.227.140.45 # à utiliser si la découverte STUN se trompe (mettre alors use_external_ip: false)
  # turn_servers:           # TURN externe (coturn existant), secret partagé
  #   - host: turn.example.org
  #     port: 443
  #     protocol: tls       # tls | tcp | udp
  #     secret: "..."       # ou secret_file: /path ; ttl: 14400 par défaut
keys:
  APIxxxxxxxx: "secret-long-aleatoire"
room:
  auto_create: false       # la salle ne se crée que si le serveur l'a autorisé (cf. Element Call)
  empty_timeout: 300
webhook:
  api_key: APIxxxxxxxx
  urls: ["http://127.0.0.1:<port-axum>/livekit/webhook"]
turn:
  enabled: false           # ou true pour le TURN intégré, voir ci-dessous
```

Notes vérifiées dans `config-sample.yaml` :
- Sur `use_external_ip` : « when set to true, attempts to discover the host's public IP via STUN ». Sur `node_ip` : « use_external_ip takes precedence, for this to take effect, set use_external_ip to false ».
- Sur `udp_port` : « port_range_start & end must not be set for this config to take effect » ; « we recommend using a range of ports greater or equal to the number of vCPUs ».
- Sur `tcp_port` : « this port *cannot* be behind load balancer or TLS ».
- `rtc.turn_servers` prend `host`, `port`, `protocol` (tls/tcp/udp), `secret` ou `secret_file` (identifiants éphémères de type coturn `use-auth-secret`, avec un `ttl` de 14400 s par défaut), ou `username`/`credential` en statique.
- Le TURN intégré (`turn:`) accepte `enabled`, `domain` (qui doit correspondre au certificat), `tls_port: 5349`, `udp_port: 3478`, `relay_range_start/end` (par défaut 1024-30000), `cert_file`/`key_file` et `external_tls: true` si un load balancer L4 termine le TLS.
- `allow_tcp_fallback` (vrai par défaut) bascule automatiquement vers ICE/TCP, puis vers TURN/TLS, quand l'UDP est instable.
- Filtres utiles avec Docker : `rtc.interfaces.excludes: [docker0]` et `rtc.ips`.
- Redis : « when redis is set, LiveKit will automatically operate in a fully distributed fashion ». Il est donc **facultatif pour un seul nœud**. La doc de déploiement le dit « recommended for production » mais sans le rendre obligatoire.
- `prometheus_port: 6789` est disponible en option.
- Source : https://raw.githubusercontent.com/livekit/livekit/master/config-sample.yaml

**TURN intégré ou coturn existant ?** Le coturn est déjà en place et `rtc.turn_servers` accepte directement son secret partagé. Garder coturn évite d'ouvrir 3478/5349 une seconde fois. Le TURN/TLS sur 443 est le recours pour les réseaux d'entreprise.

### 2.3 Pare-feu et nginx
Ports, d'après https://docs.livekit.io/transport/self-hosting/ports-firewall/ :

| Port | Proto | Clé | Rôle |
|---|---|---|---|
| 7880 | TCP (WS) | `port` | API + signalisation, **derrière nginx 443**, ne pas l'exposer |
| 7881 | TCP | `rtc.tcp_port` | ICE/TCP, **à exposer directement** |
| 50000-60000 | UDP | `rtc.port_range_*` | ICE/UDP (plage) |
| 7882 | UDP | `rtc.udp_port` | ICE/UDP mux (optionnel, remplace la plage) |
| 3478 | UDP | `turn.udp_port` | TURN/STUN intégré |
| 5349 (ou 443) | TLS | `turn.tls_port` | TURN/TLS intégré |

- Sur le VPS IONOS, il faut ouvrir ces ports **dans UFW et dans le pare-feu IONOS** (cf. mémoire `feedback_ionos_dual_firewall`). Le mux UDP sur un port unique réduit la surface d'ouverture : 1 port UDP au lieu de 10 000.
- nginx, repris du guide Element Call :

```nginx
location ^~ /livekit/sfu/ {
  proxy_pass http://127.0.0.1:7880/;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_buffering off;
  proxy_read_timeout 120; proxy_send_timeout 120;
}
```

Le client se connecte alors à `wss://chat.example.org/livekit/sfu`. Le SDK ajoute lui-même `/rtc` (et `/rtc/validate`). **[Suffixe exact NON VÉRIFIÉ dans le code 2.22.3]**

- Ressources : « The scalability of LiveKit is bound by CPU and bandwidth ». La doc recommande des instances « compute-optimized » et du 10 Gbps pour la grosse production. Pour un serveur communautaire, le facteur limitant sera la **bande passante montante du VPS** : chaque stream 1080p60 à environ 5 Mbps est retransmis à chaque spectateur. **[Aucun chiffre officiel de RAM ou CPU minimum trouvé ; Stoat annonce 4 Go de RAM minimum pour l'ensemble de sa pile, non spécifique à LiveKit]**

### 2.4 Jeton d'accès (vérifié dans le code de `livekit/protocol`)
- Algorithme **HS256**, clé = secret de l'API : `jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(t.secret))` (`auth/accesstoken.go`). Durée de validité par défaut : 6 h.
- Claims enregistrés : `iss` = clé d'API, `sub` = identité, `iat`, `nbf`, `exp`.
- Claims LiveKit (`auth/grants.go`) : `name`, `metadata`, `attributes` (map string→string), `video`, `sha256` (réservé aux webhooks), `kind`, `roomConfig`, `roomPreset`.
- Champs de `video` (noms JSON exacts) : `roomJoin`, `room`, `canPublish`, `canSubscribe`, `canPublishData`, `canPublishSources` (tableau), `canUpdateOwnMetadata`, `hidden`, `recorder`, `roomCreate`, `roomList`, `roomAdmin`, `roomRecord`, `ingressAdmin`, `destinationRoom`, `canSubscribeMetrics`, `agent`.
  - Si aucune permission n'est donnée explicitement, **tout est accordé** : publier et s'abonner.
  - `canPublishSources` **remplace** `canPublish` quand il est présent. Valeurs possibles, en minuscules : `camera`, `microphone`, `screen_share`, `screen_share_audio`.
  - Par défaut, un participant ne peut **pas** modifier ses propres métadonnées.
- Génération en Rust sans SDK (`jsonwebtoken`, dernière version stable **11.1.0** sur crates.io) :

```rust
#[derive(serde::Serialize)]
struct VideoGrant<'a> { #[serde(rename="roomJoin")] room_join: bool, room: &'a str,
  #[serde(rename="canPublish")] can_publish: bool, #[serde(rename="canSubscribe")] can_subscribe: bool,
  #[serde(rename="canPublishData")] can_publish_data: bool,
  #[serde(rename="canPublishSources")] can_publish_sources: &'a [&'a str] }
#[derive(serde::Serialize)]
struct Claims<'a> { iss: &'a str, sub: &'a str, name: &'a str, nbf: u64, exp: u64, video: VideoGrant<'a> }
let jwt = jsonwebtoken::encode(&jsonwebtoken::Header::new(jsonwebtoken::Algorithm::HS256),
  &claims, &jsonwebtoken::EncodingKey::from_secret(api_secret.as_bytes()))?;
```

  - Depuis la v10, `jsonwebtoken` impose de choisir un backend crypto par feature (`aws_lc_rs` ou `rust_crypto`). **[À vérifier dans le README 11.x ; le crate officiel `livekit-token` 0.1.2 utilise `jsonwebtoken = { version = "10", default-features = false }`]**
  - Alternative officielle : le crate `livekit-api` 0.7.1 (features `access-token` et `webhooks`), qui s'appuie sur `livekit-token` 0.1.2. C'est une dépendance de plus mais le format est garanti.
  - Sécurité : TTL court (quelques minutes suffisent, le jeton ne sert qu'à la connexion et aux reconnexions de la session). `room` = identifiant du salon vocal **après vérification de l'appartenance du membre côté serveur** (contre l'IDOR). `sub` = identifiant utilisateur stable.

### 2.5 Webhooks (vérifié dans `livekit/protocol/webhook`)
- Requête `POST` avec `Content-Type: application/webhook+json`. Le corps est l'événement sérialisé en protojson.
- En-tête `Authorization` : un JWT signé comme un jeton d'accès (HS256, `iss` = clé d'API, validité 5 min) avec le claim **`sha256` = base64 standard du SHA-256 du corps brut**.
- Vérification côté Axum :
  1. décoder et vérifier le JWT avec le secret correspondant à `iss` ;
  2. calculer `base64(sha256(corps))` ;
  3. comparer en temps constant avec `claims.sha256`.
- Événements : `room_started`, `room_finished`, `participant_joined`, `participant_left`, `participant_connection_aborted`, `track_published`, `track_unpublished`, plus `egress_*` et `ingress_*`.
- Sources :
  - https://docs.livekit.io/home/server/webhooks/
  - https://github.com/livekit/protocol/blob/main/webhook/url_notifier.go
  - https://github.com/livekit/protocol/blob/main/webhook/verifier.go

---

## 3. SDK JS `livekit-client` (v2.22.3, npm « latest », 2026-09-07)

API vérifiées dans `src/` de `livekit/client-sdk-js` (main) :

- **Connexion** : `const room = new Room({ adaptiveStream: true, dynacast: true, webAudioMix, audioOutput, encryption, reconnectPolicy, disconnectOnPageLeave, singlePeerConnection, ... })`, puis `await room.connect(url, token)`. Pour préchauffer la connexion : `room.prepareConnection(url, token)`.
  - `adaptiveStream` : le serveur envoie la couche de simulcast adaptée à la taille réelle de l'élément vidéo, et met la vidéo en pause si l'élément est caché.
  - `dynacast` : l'émetteur arrête d'encoder les couches que personne ne regarde.
  - Ces deux options réalisent le « ne pas télécharger un stream qu'on ne regarde pas ». Pour un vrai « Regarder le stream » à la Discord, il faut en plus `autoSubscribe: false` sur les sources `screen_share`, et appeler `publication.setSubscribed(true)` quand l'utilisateur clique.
- **Publier le micro traité** (après suppression de bruit maison) : `room.localParticipant.publishTrack(track: LocalTrack | MediaStreamTrack, options?: TrackPublishOptions)`. On passe le `MediaStreamTrack` de sortie du graphe WebAudio avec `{ source: Track.Source.Microphone }`. Autre option : l'API processeur `LocalTrack.setProcessor()` / `stopProcessor()`, qui remplace la piste via `sender.replaceTrack`. Pour changer de piste à chaud : `LocalTrack.replaceTrack(mediaStreamTrack, userProvidedTrack?)`. Options audio utiles : `dtx`, `red`, `audioPreset`.
- **Partage d'écran avec audio** : `localParticipant.setScreenShareEnabled(true, ScreenShareCaptureOptions, TrackPublishOptions)`, ou `createScreenTracks(options)` suivi de `publishTrack`.
  - `ScreenShareCaptureOptions` : `audio`, `video` (`displaySurface`), `resolution`, `contentHint` (`detail`, `text` ou `motion`), `selfBrowserSurface`, `surfaceSwitching`, `systemAudio` (`include` ou `exclude`), `suppressLocalAudioPlayback`, `preferCurrentTab`, `controller`.
  - L'audio publié porte la source `Track.Source.ScreenShareAudio` (`'screen_share_audio'`).
  - Préréglages `ScreenSharePresets` : `h720fps30` (2 Mbps), `h1080fps15` (2,5 Mbps), `h1080fps30` (5 Mbps), `original` (0×0, 7 Mbps, 30 i/s). Pour du 1080p60, il faut définir un `VideoPreset` perso via `screenShareEncoding`.
  - Côté navigateur, l'audio système au partage d'un **écran entier** fonctionne sous Windows/Chromium, mais **pas au partage d'une fenêtre**. **[Limite Chromium connue, NON revérifiée pour 2026 ni dans WebView2]**
- **Simulcast** : `TrackPublishOptions.simulcast`, `videoSimulcastLayers`, `screenShareSimulcastLayers`, `videoCodec` (VP8, H264, VP9, AV1), `backupCodec`, `degradationPreference`. Le serveur v1.13.7 annonce « Support VP9/AV1 simulcast ».
- **Volume par participant** :
  - `RemoteParticipant.setVolume(volume, source = Microphone | ScreenShareAudio)`, qui permet un volume séparé pour la voix et pour le son du stream ;
  - `RemoteAudioTrack.setVolume(v)` : sans `AudioContext`, il écrit `el.volume` (plafonné à 1). Avec `webAudioMix`, il passe par un `GainNode` (`gain.setTargetAtTime`), ce qui **permet de dépasser 1** et donc d'atteindre les 200 %.
  - `RemoteAudioTrack.setWebAudioPlugins(nodes)` accepte une chaîne WebAudio perso.
- **Rattacher les pistes** : `track.attach(element?)` et `track.detach()`. Dans `RoomEvent.TrackSubscribed`, on fait `track.attach(videoEl)`.
- **Événements** (`RoomEvent`) : `ActiveSpeakersChanged`, `ConnectionQualityChanged`, `Reconnecting`, `SignalReconnecting`, `Reconnected`, `Disconnected`, `TrackSubscribed`, `AudioPlaybackStatusChanged` (le navigateur bloque la lecture automatique : il faut appeler `room.startAudio()` sur un geste de l'utilisateur), `MediaDevicesChanged`, `ActiveDeviceChanged`, `EncryptionError`.
- **Reconnexion** : `reconnectPolicy` (nouvelles tentatives), avec d'abord une reprise de session (resume) puis une reconnexion complète. `allow_tcp_fallback` côté serveur prend le relais si l'UDP est instable. Les v2.22.x corrigent « signal reconnection problems » et « subscriber buffering ».
- **Périphériques** : `Room.getLocalDevices(kind)`, `room.switchActiveDevice('audiooutput' | 'audioinput' | 'videoinput', deviceId)`. `RemoteAudioTrack.setSinkId(deviceId)` applique `setSinkId` à tous les éléments rattachés, quand le navigateur le supporte.
- **E2EE** : option `encryption: { keyProvider: new ExternalE2EEKeyProvider(), worker: new Worker(...) }`, marquée `@experimental`. L'ancienne option `e2ee` est dépréciée. Il faut les Insertable Streams ou `RTCRtpScriptTransform`. Coût : l'E2EE empêche toute transformation côté serveur, ce qui ne pose pas de problème pour un SFU.
- **WebView2** : c'est Chromium, donc le SDK fonctionne. Points d'attention : la politique de lecture automatique (`startAudio`), les autorisations micro, caméra et capture d'écran (dialogue de permission WebView2), et `getDisplayMedia` qui passe par le sélecteur WebView2. **[Comportement exact de `getDisplayMedia` et de `systemAudio` dans WebView2 NON VÉRIFIÉ]**
- **WebKitGTK** : voir §5.4 (WebRTC probablement absent). Aucun SDK JS WebRTC n'y fonctionnera sans une WebKitGTK compilée avec `ENABLE_WEB_RTC=ON`.
- Sources :
  - https://github.com/livekit/client-sdk-js : `src/options.ts`, `src/room/events.ts`, `src/room/track/options.ts`, `RemoteAudioTrack.ts`, `RemoteParticipant.ts`, `LocalParticipant.ts`, `Track.ts`
  - https://www.npmjs.com/package/livekit-client

---

## 4. Discord : les fonctions à égaler ou dépasser

- **Pop-out** : Discord ne détache qu'**une seule fenêtre pour tout l'appel**, redimensionnable et « Stay On Top ». Les utilisateurs demandent depuis 2021 des pop-outs **par stream** (post communautaire 4408333204631). **C'est la fonction à dépasser : plusieurs streams, chacun dans sa fenêtre.**
- **Aperçu des streams** : une vignette rafraîchie périodiquement dans la liste des membres. Côté LiveKit, cela peut se faire en s'abonnant à la couche de simulcast la plus basse, ou avec une capture JPEG publiée par data message.
- **« Regarder le stream » sur demande** : le stream n'est pas téléchargé tant qu'on ne clique pas (voir `autoSubscribe: false` au §3).
- **Focus/spotlight** et **grille**, bascule entre les deux, épingler un participant.
- **Volume par utilisateur de 0 à 200 %**, séparé du volume de son stream ; sourdine locale d'un utilisateur.
- **Suppression de bruit (Krisp)**, annulation d'écho, contrôle automatique de gain. ForgeChat a déjà quatre moteurs : RNNoise, GTCRN, Speex et gate.
- **Push-to-talk** avec délai de relâchement, **activité vocale** avec seuil réglable et indicateur visuel.
- **Qualité de Go Live** : 720p30 pour tout le monde. 1080p60 et « Source » réservés à Nitro (4K60 selon les sources non officielles). **Égaler et dépasser : 1080p60 et Source pour tous**, selon ce que la bande passante du VPS permet.
- **Audio du stream** (système ou application), réglable indépendamment.
- **Soundboard**, **activité** (« joue à… », « regarde… »).
- **Indicateurs vocaux** : cercle de parole, micro coupé ou casque coupé (local ou serveur), icône de caméra ou de live, qualité de connexion et ping.
- Sources :
  - https://support.discord.com/hc/en-us/articles/360040816151-Go-Live-and-Screen-Share
  - https://support.discord.com/hc/en-us/community/posts/4408333204631-Pop-out-individual-stream-windows

---

## 5. Fenêtres vidéo détachées

### 5.1 `window.open` de même origine et `srcObject`
- Sous Chromium, une fenêtre ouverte par `window.open()` avec la **même origine** tourne **dans le même processus** que celle qui l'a ouverte. Les deux fenêtres ont accès au DOM l'une de l'autre, donc on peut écrire directement `popup.document.querySelector('video').srcObject = streamDeLOuvreur`, sans `createObjectURL`.
- Précautions :
  - ne pas mettre `noopener` ;
  - la fenêtre détachée meurt si la principale se recharge ;
  - la lecture automatique doit se faire en `muted`, ou après un geste de l'utilisateur ;
  - gérer `pagehide` pour faire `detach()` ;
  - les pistes restent la propriété de la fenêtre principale ;
  - il vaut mieux construire le `MediaStream` dans la fenêtre principale, ou utiliser `new popup.MediaStream([track])`. **[NON VÉRIFIÉ : lequel des deux constructeurs est requis]**
- Sources :
  - https://groups.google.com/a/chromium.org/g/chromium-extensions/c/jAwWjEAOg4k/m/Ee7fohN7AQAJ
  - https://lists.w3.org/Archives/Public/public-media-capture/2015May/0060.html

### 5.2 Document Picture-in-Picture
- `documentPictureInPicture.requestWindow()` est expérimental et « not Baseline ». La spécification impose **une seule fenêtre PiP par onglet**, et le navigateur peut limiter davantage. Réservé aux contextes sécurisés, la fenêtre reste toujours au premier plan et sa position ne peut pas être imposée. Livré dans Chrome 116 (selon l'Intent to Ship sur blink-dev).
- **Ce n'est donc pas adapté à « plusieurs streams à la fois »**. Au mieux, c'est une fenêtre flottante unique.
- WebView2 : **[support NON VÉRIFIÉ, aucune doc ni issue trouvée]**. WebKitGTK : **non supporté** (API propre à Chromium).
- Sources :
  - https://developer.mozilla.org/en-US/docs/Web/API/Document_Picture-in-Picture_API
  - https://groups.google.com/a/chromium.org/g/blink-dev/c/JTPl7fM64Lc

### 5.3 Tauri v2
- Un `WebviewWindow` créé depuis Rust tourne dans un **contexte JS séparé** : les objets `MediaStream` ne peuvent pas passer par l'IPC.
- **`on_new_window`** : `WebviewBuilder::on_new_window` et `WebviewWindowBuilder::on_new_window` ont été **ajoutés dans Tauri 2.8.0** (PR #13876). Depuis la **2.11.0**, le gestionnaire n'a plus besoin d'être `Sync` et s'exécute sur le thread principal sous Windows (PR #14862). Dernière 2.x publiée : **2.11.6** (une 3.0.0-alpha.2 existe depuis le 21/09/2026).
- Signature : `Fn(Url, NewWindowFeatures) -> NewWindowResponse<R>`, où `NewWindowResponse` vaut `Allow`, `Create { window }` ou `Deny`.
- Pour `Create`, la documentation impose : sous **Windows**, le même *environment* WebView2 que la fenêtre qui ouvre ; sous **Linux**, une webview `related_view` ; sous **macOS**, la même `webview_configuration`. `WebviewWindowBuilder::window_features(features)` applique tout cela automatiquement. L'exemple officiel crée la fenêtre avec `WebviewUrl::External("about:blank")` et `.window_features(features)`.
  - C'est ce qui garde le lien `window.opener`. La fenêtre peut alors, en théorie, partager le processus et les objets JS de celle qui l'a ouverte. **[Partage effectif d'un `MediaStream` dans WebView2 NON VÉRIFIÉ : à tester en premier]**
  - Il faut un label unique par fenêtre (l'exemple le signale lui-même), sinon un seul pop-out est possible à la fois.
- **Plan B robuste**, qui marche partout : chaque fenêtre détachée est une vraie page ForgeChat. Elle demande au serveur un jeton `hidden: true, canPublish: false` (identité dérivée, par exemple `userId#popout-N`) et **s'abonne elle-même** au seul stream voulu. Coût : une connexion et un flux descendant de plus par fenêtre, et un léger décalage entre la vidéo détachée et l'audio de la fenêtre principale.
- Sources :
  - https://github.com/tauri-apps/tauri : `crates/tauri/src/webview/mod.rs`, `crates/tauri/CHANGELOG.md` sections 2.8.0 et 2.11.0
  - https://github.com/tauri-apps/tauri/pull/13876

### 5.4 Linux (WebKitGTK) : bloquant à vérifier en premier
- D'après une PR tierce qui a testé WebKitGTK 2.52.6 : « WebKitGTK as every distribution ships it has WebRTC compiled out ».
  - Cause : `ENABLE_WEB_RTC` suit `ENABLE_EXPERIMENTAL_FEATURES`, qui est `OFF` par défaut.
  - `enable-webrtc` est un simple stub : il relit `true` alors que `RTCPeerConnection` reste indéfini.
  - Exemple cité : le PKGBUILD `webkit2gtk-4.1` d'Arch.
- Plusieurs issues Tauri vont dans le même sens : tauri#13143 (« The current browser does not support WebRTC » sur Ubuntu 22.04), wry#85.
- Le support en amont repose sur GstWebRTC (GStreamer ≥ 1.20) et reste en cours (FOSDEM 2025 et 2026).
- **Conséquence** : sous Linux, la voix de l'app Tauri ne marche probablement **ni en mesh ni avec un SFU** tant que la WebKitGTK du système n'a pas WebRTC. Pistes :
  1. vérifier `typeof RTCPeerConnection` dans l'app sur la VM cible ;
  2. à défaut, faire tourner le média en natif Rust (le crate `livekit` de `livekit/rust-sdks`, qui utilise libwebrtc) et n'afficher que l'interface dans la webview. Gros chantier.
  3. Autre option : renvoyer les utilisateurs Linux vers le client web dans Chromium ou Firefox.
- **[Cette conclusion repose sur une source tierce et des issues ; à confirmer sur la distribution cible]**
- Sources :
  - https://github.com/gitautas/uwum/pull/20
  - https://github.com/tauri-apps/tauri/issues/13143
  - https://github.com/tauri-apps/wry/issues/85
  - https://archive.fosdem.org/2026/schedule/event/KMMLGM-webrtc_support_in_webkitgtk_and_wpewebkit_with_gstreamer_current_status_and_plan/

---

## 6. Recommandation qui découle de la recherche

1. Déployer LiveKit `v1.13.7` sur le VPS en `--network host`, avec le **mux UDP** sur un seul port (ou une plage courte) et `7881/tcp`. Le coturn existant est branché via `rtc.turn_servers`, et nginx sert `/livekit/sfu/` en `wss`. Mettre `room.auto_create: false`.
2. Le serveur Axum émet les JWT HS256 après avoir vérifié l'appartenance au salon, reçoit les webhooks `participant_joined`/`participant_left` pour la présence vocale, et crée les salles par l'API `RoomService` (Twirp, avec un jeton `roomCreate`). **[Endpoint Twirp exact NON VÉRIFIÉ ici]**
3. Côté client : `livekit-client` 2.22.3 avec `adaptiveStream`, `dynacast` et `webAudioMix` (pour le volume à 200 %). Le micro traité est publié via `publishTrack(track, { source: Microphone })`. Les streams sont en abonnement sur demande.
4. Pop-outs : essayer d'abord `window.open` avec `on_new_window` et `window_features`, en partageant la piste. Si WebView2 ne partage pas le `MediaStream`, basculer sur une connexion SFU par fenêtre (jeton `hidden`).
5. Linux : vérifier la présence de `RTCPeerConnection` avant tout travail dessus.
