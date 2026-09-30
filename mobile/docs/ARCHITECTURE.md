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

## Appels et vocal (WebRTC)

Protocole identique au client web (`client/src/store/call.ts` et `voice.ts`), donc interopérable :

- **Appel 1:1** : `DM_CALL_INIT → DM_CALL_INCOMING`, `DM_CALL_ACCEPT → DM_CALL_ACCEPTED`, puis offre /
  réponse / ICE via `VOICE_SIGNAL` (`payload.sdp` / `payload.candidate`). Sonnerie 45 s, tolérance de
  6 s aux coupures, redémarrage ICE en cas d'échec.
- **Salon vocal** : maillage (mesh) ; le nouvel arrivant envoie une offre à chaque pair
  (`VOICE_EXISTING_PEERS`) ; `VOICE_SIGNAL` avec `payload.data` ; gestion du glare « pair poli ». Le
  mobile émet l'audio et reçoit audio + vidéo.
- **Appel vers un mobile fermé** (patch serveur) : le serveur envoie un push « appel entrant » au lieu
  de répondre « hors ligne » ; à l'ouverture de l'app, la reconnexion WebSocket rejoue
  `DM_CALL_INCOMING` si l'appelant attend toujours.
- Routage audio (écouteur / haut-parleur / Bluetooth, capteur de proximité, sonneries) :
  `react-native-incall-manager`. Configuration ICE (STUN/TURN) : `GET /api/voice/ice-config`.

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
