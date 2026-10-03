# Architecture de l'app mobile

## Vue d'ensemble

```
┌──────────────────────────── Écrans (src/app, Expo Router) ────────────────────────────┐
│  (auth) login/register   (app)/(tabs) serveurs·messages·amis·mentions·vous            │
│  channel/dm/group → ChatView        call / voice        settings/*        invite/*    │
└──────────────┬───────────────────────────────┬────────────────────────────────────────┘
               │ hooks (useQuery, useConversation, stores Zustand)
┌──────────────▼──────────────┐   ┌────────────▼─────────────┐   ┌─────────────────────┐
│ TanStack Query (cache REST) │◀──│ realtimeBindings          │◀──│ realtime (WebSocket) │
│ messages, serveurs, amis…   │   │ événements WS → cache/    │   │ ticket, heartbeat,   │
└──────────────┬──────────────┘   │ stores (non-lus, présence)│   │ watchdog, backoff    │
               │                  └───────────────────────────┘   └──────────┬──────────┘
┌──────────────▼──────────────┐   ┌───────────────────────────┐              │
│ api/* (endpoints typés)     │──▶│ lib/http                  │──── HTTPS ───┤──▶ Backend Rust
└─────────────────────────────┘   │ Bearer, refresh single-   │     WSS ─────┘    (inchangé
                                  │ flight, timeouts, erreurs │                    + patch push)
                                  └────────────┬──────────────┘
                                  ┌────────────▼──────────────┐
                                  │ lib/tokens                │  access token : mémoire
                                  │ expo-secure-store         │  refresh token : Keychain/Keystore
                                  └───────────────────────────┘
```

## Couches

| Couche | Rôle | Règle |
|---|---|---|
| `app/` | Écrans et navigation | Aucun appel réseau direct : passe par `api/` ou des hooks |
| `features/` | Logique d'UI par domaine (chat, serveurs, amis) | Réutilisable entre écrans |
| `api/` | Un module par domaine REST, typé | Seul endroit qui connaît les URL du serveur |
| `lib/` | Briques transverses sans UI | Testables unitairement |
| `services/` | Intégrations plateforme (push, audio, cycle de vie) | Branchées une fois dans `app/_layout.tsx` |
| `stores/` | État global (Zustand) | Petits stores ciblés, pas de « god store » |

## Authentification

1. `POST /api/auth/login` → `access_token` (JWT) + `refresh_token` (opaque, 30 j).
2. Le refresh token va dans le Keychain/Keystore ; l'access token reste **en mémoire**.
3. Au démarrage à froid : `POST /api/auth/refresh` (rotation) → nouvel access token, puis `GET /users/me`.
4. Chaque requête : `ensureAccessToken()` rafraîchit de façon proactive (< 60 s d'expiration). Un 401
   déclenche un refresh unique (single-flight) puis un seul nouvel essai.
5. Refresh refusé (révoqué, mot de passe changé…) → effacement local complet + retour à l'écran de connexion
   avec un message.

Le mobile n'utilise **jamais** les cookies (`credentials: 'omit'`) : il s'authentifie uniquement en Bearer.

## Temps réel

- Connexion : `POST /api/auth/ws-ticket` → `wss://…/ws?ticket=…` (ticket Redis 30 s, usage unique).
- Heartbeat 25 s ; watchdog 70 s sans trafic → reconnexion (sockets « zombies » après changement de réseau).
- Reconnexion exponentielle avec jitter ; à chaque (re)connexion : invalidation des messages, des
  conversations et rechargement des non-lus (rattrape ce qui a été manqué).
- `services/realtimeBindings.ts` est l'unique traducteur « événement serveur → cache/état ». Les champs
  reçus sont vérifiés (types, tailles) avant usage.

### Cycle de vie

| État de l'app | WebSocket | Conséquence |
|---|---|---|
| Premier plan | Ouvert | Événements temps réel |
| Arrière-plan (sans appel) | **Fermé volontairement** | Le serveur voit l'utilisateur hors ligne → notifications push |
| Arrière-plan en appel / vocal | Ouvert (mode audio iOS) | L'appel continue |
| Retour au premier plan | Rouvert | Resynchronisation + verrouillage biométrique si délai dépassé |

## Messagerie

Le serveur expose trois formats (salon, DM, groupe). `features/chat/adapters.ts` les convertit en un
unique `ChatMessage` ; `api/messages.ts` route vers les bons endpoints. Tout l'écran de chat
(`ChatView`) est donc commun aux trois types de conversation.

Cache (`features/chat/cache.ts`) : `InfiniteData` TanStack, `pages[0]` = page la plus récente.

- Envoi optimiste : message `tmp-…` affiché immédiatement, confirmé par la réponse HTTP. Si l'écho
  WebSocket arrive avant la réponse, le temporaire est retiré (pas de doublon).
- Pièces jointes : message créé avec `has_attachments`, puis upload multipart sur l'id réel.
- Historique : `before=<id du plus ancien>` au défilement (liste inversée).

## Appels et vocal (LiveKit)

Protocole du serveur ForgeChat ≥ 3.251 et du client web (`client/src/store/call.ts`, `voice.ts`,
`voiceSfu.ts`) : la signalisation passe par le WebSocket, **tout le média par le SFU LiveKit** (plus de
pair-à-pair). Le serveur ne délivre un jeton LiveKit qu'après ses contrôles ; l'identité LiveKit d'un
participant est son id utilisateur.

- **Appel 1:1** (`src/stores/call.ts`) : `DM_CALL_INIT → DM_CALL_INCOMING` ; l'appelé envoie
  `DM_CALL_ACCEPT` ; l'appelant reçoit `DM_CALL_ACCEPTED { livekit }`, l'appelé `DM_CALL_MEDIA { livekit,
  session_id }` (seule la session qui décroche ; les autres reçoivent `DM_CALL_TAKEN`). Les deux rejoignent
  la salle et publient micro (+ caméra). Partage d'écran : l'écran remplace la caméra (dépubliée).
  Sonnerie 45 s, connexion 30 s, 20 s de grâce si le correspondant disparaît.
- **Salon vocal** (`src/stores/voice.ts`) : présence par le WebSocket (`VOICE_JOIN → VOICE_EXISTING_PEERS
  { peers, livekit, can_speak, server_muted }`, `VOICE_USER_JOINED/LEFT`, `VOICE_STATE(_UPDATE)`) ;
  média LiveKit : micro et écran émis, son, caméras et écrans des autres reçus.
- **Adresse LiveKit** vérifiée avant connexion (`src/config/livekitUrl.ts`) : bêta = `wss://` sur l'hôte du
  serveur (ou celui fixé au build) ; APK DEV = `wss://`, ou `ws://` vers une IP locale.
- **Relais réseau** : seuls les relais TURN de `GET /api/voice/ice-config` sont passés à LiveKit (jamais de
  STUN, public ou non).
- **Appel vers un mobile fermé** (patch serveur) : le serveur envoie un push « appel entrant » au lieu
  de répondre « hors ligne » ; à l'ouverture de l'app, la reconnexion WebSocket rejoue
  `DM_CALL_INCOMING` si l'appelant attend toujours.
- Audio : session d'appel et sortie (haut-parleur / écouteur / Bluetooth) par `AudioSession` de LiveKit ;
  sonneries et écran allumé par `react-native-incall-manager`.

## Navigation

Expo Router avec routes protégées (`Stack.Protected`) : `(app)` n'existe que connecté, `(auth)` que
déconnecté. Les routes accessibles par lien profond valident leurs paramètres (UUID, codes
d'invitation) avant tout appel réseau (`lib/params.ts`). Les couches globales (démarrage, verrou,
appel entrant, bandeau de connexion, appel en cours) sont superposées dans `app/_layout.tsx`.

## Pistes d'évolution

- CallKit (iOS) / ConnectionService (Android) + pushes VoIP pour une vraie UI d'appel système et un
  service au premier plan Android pour les longs appels en arrière-plan.
- Cache chiffré hors-ligne (lecture des dernières conversations sans réseau).
- Forums, fils, sondages, administration de serveur, partage d'écran.
- Chiffrement de bout en bout des DM (le serveur a déjà des endpoints `/e2e`).
