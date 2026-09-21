# PRD — Refonte fiabilité Vocal / Vidéo / Stream (ForgeChat)

| | |
|---|---|
| **Document** | PRD-vocal-video-stream |
| **Date** | 2026-09-21 |
| **Auteur** | Claude (audit 4 agents parallèles : audio, vidéo/négociation, partage d'écran, signalisation/infra) |
| **Statut** | À valider par Momo (2 décisions ouvertes, §9) |
| **Versions auditées** | server `3.248.0` · client `3.580.0` · desktop `3.22.0` · commit `6877119` |
| **Périmètre** | Appels vocaux de serveur, appels DM 1-à-1, caméra, partage d'écran / « Go Live », suppression de bruit, infrastructure de signalisation et TURN |
| **Hors périmètre** | Chat texte, forum, modération, mobile natif, paiements |

---

## 1. Résumé exécutif

L'audit a porté sur l'intégralité de la chaîne temps réel : `client/src/store/voice.ts` (1051 lignes), `client/src/store/call.ts`, `client/src/pages/VoiceVideoPage.tsx`, `client/src/components/voice/*`, `client/src/components/settings/{AudioSection,VideoSection,KeybindingsSection}.tsx`, `client/src/hooks/useVoiceActivity.ts`, `server/src/handlers/{websocket,voice}.rs`, `server/src/state.rs`, `desktop/src-tauri/`, `docker-compose.yml`, `nginx.conf`, `.env.example`.

**61 défauts réels ont été identifiés et localisés à la ligne près** (aucun n'est hypothétique), dont **7 critiques**, **14 élevés**. Ils expliquent l'intégralité des symptômes rapportés : son qui coupe, suppression de bruit qui ne marche « qu'une fois », vidéo qui n'apparaît pas, stream invisible pour l'ami, vignette qui disparaît, retour audio absent.

Cinq causes racines produisent à elles seules la majorité des symptômes :

| Cause racine | Conséquences visibles |
|---|---|
| **R1 — Aucun `onnegotiationneeded` dans tout le client** (0 occurrence dans `client/src`) | Un arrivant tardif ne voit jamais la caméra ni le stream déjà actifs. Toute renégociation ratée est définitive. |
| **R2 — Aucune re-synchronisation vocale après reconnexion WebSocket** | Après une micro-coupure ou un déploiement, l'utilisateur est « en appel » côté UI et absent côté serveur. Fantômes des deux côtés. |
| **R3 — Chaîne de suppression de bruit non réinitialisable** (cache de module lié à un `AudioContext` fermé) | La NS fonctionne au premier salon de la session, puis jamais plus, et le toggle des Réglages devient inerte. |
| **R4 — État vocal 100 % en mémoire process, clé `user_id`** | Chaque `docker compose up` vide les salons ; deux onglets cassent l'appariement ; F5 affiche des salons vides. |
| **R5 — Mesh P2P sans SFU, sans simulcast, sans plafond de débit** | Injouable au-delà de ~6 caméras ; un stream 1080p30 envoie N × 2,5 Mb/s en montée. |

Le correctif à plus fort rendement est **R1** : un seul handler `pc.onnegotiationneeded` dans `_createPC` (`voice.ts:319`) répare d'un coup la caméra ET le stream pour tout arrivant tardif, et rend redondants les trois `createOffer` manuels de `voice.ts:841`, `:896`, `:949`. La logique de glare « polie » qui l'absorbe existe déjà (`voice.ts:686-706`).

---

## 2. Contexte et état actuel

### 2.1 Architecture temps réel existante

```
Client A ──WS VOICE_SIGNAL──> Axum (relais pur, aucun média) ──WS──> Client B
   └──────────────── RTCPeerConnection directe (mesh P2P) ─────────────┘
                              ICE: STUN Google ×3 + TURN coturn (VPS, hors dépôt)
```

- **Topologie** : full-mesh P2P, une `RTCPeerConnection` par pair (`voice.ts:87`). Le serveur ne transporte aucun média.
- **Signalisation** : messages WS `VOICE_JOIN` / `VOICE_LEAVE` / `VOICE_STATE` / `VOICE_SIGNAL`, relais ciblé (`websocket.rs:917-948`).
- **Deux chemins de code média totalement distincts** : `voice.ts` (salons de serveur) et `call.ts` (DM 1-à-1). Même type WS `VOICE_SIGNAL` mais **deux formats de payload incompatibles** (`payload.data` vs `payload.sdp`), discriminés par des gardes défensives (`voice.ts:675`, `call.ts:183`). `call.ts` est une version dégradée de `voice.ts` : ni glare, ni renégociation, ni suppression de bruit, ni choix du micro.
- **État serveur** : `voice_rooms`, `user_voice`, `voice_states`, `stage_speakers` — `HashMap` en mémoire process (`state.rs:34-42`), rien en Redis, rien en PostgreSQL.
- **ICE** : servie par `GET /api/voice/ice-config` (`voice.rs:8-36`), credentials TURN statiques issus de l'env.
- **Suppression de bruit actuelle** : chaîne WebAudio maison — highpass 85 Hz → lowpass 8 kHz → `AudioWorklet` noise-gate RMS maison (`client/public/noise-gate-worklet.js`) → compresseur → gain 1,4 (`voice.ts:162-202`). Aucun modèle ML, aucun RNNoise.

### 2.2 Ce qui fonctionne déjà correctement (à ne pas casser)

- L'audio des pairs est joué par un composant persistant monté à la racine (`PersistentVoiceAudio` via `App.tsx:1035`) : **le son survit à la navigation**, c'est le bon design.
- L'état d'appel vit dans des singletons de module hors React (`voice.ts:86-113`) : **quitter la page d'appel ne coupe ni le micro, ni le stream**.
- Le tie-break de glare « polite peer » (`myId < from`, `voice.ts:686-706`) est cohérent des deux côtés : pas de boucle d'offres infinie sur le chemin serveur.
- `_camSenders` (`voice.ts:105-111`) évite correctement le piège du sender `recvonly` auto-créé.
- La désactivation caméra passe par `replaceTrack(null)` sans renégociation : **l'audio n'est jamais coupé par un toggle caméra** (chemin serveur).
- L'attache des flux distants se fait en ref callback et non en `useEffect([stream])` (`VoiceVideoPage.tsx:105-107`) : robuste aux pistes qui arrivent tard.
- L'arrêt du partage depuis la barre native Chrome est bien écouté (`voice.ts:910`, `svt.onended`).
- `HAND_RAISE` et `SOUNDBOARD_PLAY` ont été recâblés (handlers `websocket.rs:1316`, `:1344`) — le défaut historique n'est plus.

---

## 3. Objectifs

### 3.1 Objectifs produit

| # | Objectif | Mesure de succès |
|---|---|---|
| O1 | Un appel vocal à 2-6 ne coupe jamais le son sur la durée | 0 coupure audio > 500 ms sur 30 min d'appel continu, 3 sessions consécutives |
| O2 | La caméra et le stream sont visibles par **tout** participant, y compris ceux arrivés après | 100 % des arrivants tardifs reçoivent la vidéo en < 3 s |
| O3 | La suppression de bruit atteint le niveau attendu d'un Krisp/Discord | Bruit de fond (clavier, ventilateur, voix hors champ) atténué ≥ 20 dB sans artefact sur la voix ; fonctionne à chaque salon, pas seulement au premier |
| O4 | Le retour audio du stream fonctionne : l'ami entend le jeu | Son du jeu reçu par tous les viewers, y compris arrivants tardifs, y compris en partage de **fenêtre** |
| O5 | Le stream survit à la navigation : changer de serveur/canal ne l'interrompt pas, une miniature reste visible | Stream continu vérifié sur 10 navigations ; vignette visible même quand ForgeChat n'a pas le focus |
| O6 | Un déploiement ou une micro-coupure réseau ne laisse personne en appel fantôme | Après `deploy.sh`, 100 % des participants sont re-synchronisés en < 10 s sans action manuelle |
| O7 | Aucune fonctionnalité annoncée dans l'UI n'est un placebo | 0 réglage/permission/raccourci exposé sans implémentation |

### 3.2 Non-objectifs (cette itération)

- Enregistrement des appels côté serveur.
- Sous-titrage/transcription temps réel.
- Vidéo au-delà de 1080p ou HDR.
- Application mobile native (la PWA reste hors périmètre).
- Compatibilité navigateurs hors Chromium/Firefox/Safari récents et WebView2/WebKitGTK du desktop.

---

## 4. Inventaire des défauts

Sévérités : 🔴 **CRITIQUE** (perte de service, fuite de vie privée ou de sécurité) · 🟠 **ÉLEVÉE** · 🟡 **MOYENNE** · 🟢 **FAIBLE**.

### 4.1 Bloc A — Chaîne audio

| ID | Sév. | Fichier:ligne | Symptôme utilisateur | Cause racine |
|---|---|---|---|---|
| A1 | 🔴 | `client/src/store/voice.ts:146-160`, `:207-209`, `:227-234` | La suppression de bruit marche au **premier** salon vocal de la session, puis plus jamais. Aucune erreur console. | `_noiseWorkletModule` met en cache une `Promise` liée au `AudioContext` **fermé** ; `_cleanupNoiseSuppression` ne la remet pas à `null`. `new AudioWorkletNode` lève `InvalidStateError` sur le nouveau contexte, le `catch` de `:222` renvoie le flux **brut**. |
| A2 | 🔴 | `client/src/store/voice.ts:1016`, `:1021` | Micro coupé → on bascule le toggle « Suppression de bruit » → **le micro redevient live alors que l'icône affiche toujours « coupé »**. Les autres entendent tout. | `_pushMicTrackToSenders` pousse un track dont `enabled === true` sans réappliquer l'état `muted` posé par `toggleMute:780`. |
| A3 | 🔴 | `client/src/pages/VoiceVideoPage.tsx:197` (entrée `:503`, `:554`) | Cliquer « Agrandir » sur **sa propre** tuile déclenche un larsen immédiat. | `FullscreenViewer` rend `<video autoPlay>` **sans `muted`**, et `onExpand` est proposé pour la tuile locale, dont le stream contient la piste micro. |
| A4 | 🔴 | `client/src/store/voice.ts:750-763`, `:597-607` | Après avoir quitté un salon, **l'indicateur micro de l'OS reste allumé** jusqu'au rechargement de la page. Cas par défaut (NS active). | `_localStream` est remplacé par `_processedStream` ; la piste micro brute n'est plus référencée que par `_rawAudioTrack`, absent du `Set` des pistes stoppées par `leave()`. |
| A5 | 🟠 | `client/src/pages/DMPage.tsx:625` | Tout appel **vidéo** DM : voix du correspondant jouée **deux fois** (volume doublé, flanging/écho métallique). | `remoteVideoRef` reçoit `remoteStream` sans `muted`, alors que `PersistentDmCallAudio.tsx:29-39` joue déjà le même stream. |
| A6 | 🟠 | `client/src/pages/VoiceVideoPage.tsx:615` | Vue « Présentation » sans partage : le pair mis en avant est audible deux fois ; son volume individuel et le duck priority-speaker ne s'appliquent plus. | `muted={presenter.kind === 'camera' && presenter.peer.isLocal}` → `false` pour un distant. |
| A7 | 🟠 | `client/src/store/call.ts:148` | Le micro choisi dans Réglages → Audio est **ignoré en appel DM** ; aucune suppression de bruit en DM. | `getUserMedia({ audio: true })` nu : ni `deviceId`, ni EC/NS/AGC explicites, ni appel à `_applyNoiseSuppression`. |
| A8 | 🟠 | `client/src/store/voice.ts:962` · `VoiceVideoPage.tsx:443-455` · `KeybindingsSection.tsx:10` | Le **push-to-talk n'existe pas** malgré un réglage dédié (défaut « Alt ») et une aide clavier qui documente P/Espace. | `setPttMode` n'a **aucun appelant** dans `client/src` → `pttMode` reste `false` → `activatePtt` sort au premier `if`. Le handler clavier code P/Espace en dur et ignore `/user/keybindings`. |
| A9 | 🟠 | `desktop/src-tauri/Cargo.toml:21-27` · `VoiceVideoPage.tsx:452-453` | Même activable, le PTT ne répondrait pas quand ForgeChat n'a pas le focus — le cas d'usage principal (jeu en plein écran). | Listeners `window` uniquement, montés dans un composant de page. `tauri-plugin-global-shortcut` absent des dépendances (0 occurrence dans le dépôt). |
| A10 | 🟠 | `useVoiceActivity.ts:37` · `VoiceActivityBar.tsx:35` · `VoiceBar.tsx:16` · `VoiceVideoPage.tsx:292-293`, `:831` | À partir de ~3 pairs, les anneaux verts « parle » et la barre d'activité **se figent définitivement**, de façon aléatoire selon l'ordre de montage. | Jusqu'à `2 + N + 3` `AudioContext` simultanés sur le même document. Chrome plafonne à **6** : `new AudioContext()` lève, exception avalée par les `catch {}` de `useVoiceActivity.ts:44`, `:108`, `VoiceActivityBar.tsx:36`. |
| A11 | 🟡 | `useVoiceActivity.ts:50-61` · `VoiceActivityBar.tsx:50-56` · `VoiceVideoPage.tsx:293` | Ventilateur qui s'emballe, interface qui rame en vocal à plusieurs, même sans vidéo. | `setLevels()` toutes les 80 ms re-render toute la page (12,5×/s) et relance l'effet dont la dep `peers` est recréée à chaque render ; `useAudioLevel` fait un `setState` à 60 Hz **par participant**. ~250 re-renders/s à 4. |
| A12 | 🟡 | `client/src/store/voice.ts:182`, `:1000`, `:1018` | Après A1, le toggle « Suppression de bruit » ne fait **plus rien du tout**. | `_noiseGain` est assigné **avant** le montage du worklet et sert de drapeau « NS active » ; il reste non-null même quand la chaîne a échoué. |
| A13 | 🟡 | `client/src/components/settings/AudioSection.tsx:90-97` | Changer de microphone pendant un appel n'a aucun effet ; il faut quitter et rejoindre. Aucun message ne le dit. | `handleInputChange` n'écrit que `localStorage` ; aucun `applyConstraints`, aucune ré-acquisition + `replaceTrack`. `applyConstraints` : **0 occurrence dans le dépôt**. |
| A14 | 🟡 | `client/src/pages/VoiceVideoPage.tsx:18`, `:289` + `VolumeSlider.tsx` (92 lignes) | **Aucun moyen de régler le volume d'un utilisateur** : le slider existe mais n'est jamais rendu (`<VolumeSlider` = 0 occurrence). | Composant importé, jamais monté ; `setUserVolume` jamais appelé ; `userVolumes` reste `{}`. |
| A15 | 🟡 | `client/src/store/voice.ts:773` | Même branché, un volume par utilisateur serait perdu à chaque sortie de salon. | `userVolumes: {}` dans le `set` final de `leave()`, aucune persistance `localStorage`. |
| A16 | 🟡 | `client/src/store/voice.ts:731-733` | En audience de Stage (écoute seule), les autres vous voient « micro ouvert » alors que vous n'avez aucun micro. | Le broadcast initial envoie `muted: false` en dur alors que le store a posé `muted: listenOnly` (`:622`). |
| A17 | 🟡 | `client/src/store/voice.ts:1038-1046` | Le mode « whisper » couperait le micro pour **tout le monde** (ou personne). Code mort aujourd'hui, bug réel dès qu'il est branché. | `sender.track.enabled` : tous les senders référencent le **même** `MediaStreamTrack` (`:294`). La dernière itération écrase les précédentes. Aggravé pendant un partage d'écran (track mixée unique, `:265-276`). |
| A18 | 🟡 | `PersistentVoiceAudio.tsx:30-40` · `PersistentDmCallAudio.tsx:29-39` | Sur navigateur à policy autoplay stricte (Safari, onglet restauré) : appel « connecté », **aucun son**, aucune indication. | `<audio autoPlay>` sans `.play()` explicite, sans `catch` du rejet, sans fallback « cliquez pour activer le son ». |
| A19 | 🟡 | `client/src/store/voice.ts:265-276`, `:240-253`, `:933-941` | Basculer la NS pendant un partage d'écran laisse un `MediaStreamDestination` orphelin ; accumulation sur une longue session. | Aucun `stop()` / `disconnect()` sur l'ancien mix ; `_micMixCtx` n'est fermé que si `_micTrackBeforeMix` est non-null. |
| A20 | 🟢 | `client/src/store/voice.ts:173-181` | Voix « pompante », respiration du bruit de fond entre les mots, sifflantes écrasées. | Compresseur `threshold=-55 dB, ratio=12` (quasi-limiteur sur tout le signal utile) + makeup gain `1.4`, **en cascade** avec l'AGC navigateur laissé à `true` (`:569`). |
| A21 | 🟢 | `client/src/store/voice.ts:786-795` | Le bouton « casque coupé » ne coupe pas le son d'un appel DM simultané, ni son propre micro (contrairement à Discord). | `toggleDeafen` n'itère que sur `get().peers` ; `call.ts` n'expose ni ne consomme `deafened`. |
| A22 | 🟢 | `useVoiceActivity.ts:3` vs `VoiceActivityBar.tsx:70`, `:93` | L'anneau vert de la tuile et la barre d'activité ne s'allument pas au même moment pour le même locuteur. | Seuils divergents (18/255 vs 10/255) et bases de calcul différentes (demi-spectre vs spectre complet). |
| A23 | 🟢 | `AudioSection.tsx:102-104` | Changer le périphérique de sortie redirige aussi les lecteurs de pièces jointes et les vidéos de messages. | `document.querySelectorAll('audio, video')` sans filtre sur les éléments d'appel. |
| A24 | 🟢 | `PersistentVoiceAudio.tsx:36-37` | Une promesse `setSinkId()` créée à chaque render du composant. | Ref callback inline : nouvelle identité à chaque render, React détache/rattache et réexécute le corps. |

### 4.2 Bloc V — Vidéo et négociation WebRTC

| ID | Sév. | Fichier:ligne | Symptôme utilisateur | Cause racine |
|---|---|---|---|---|
| V1 | 🔴 | `client/src/store/voice.ts:292-304`, `:307-310`, `:654-657` — **aucun `onnegotiationneeded` dans tout `client/src`** | **Un participant déjà en caméra ou en partage d'écran n'est JAMAIS visible par les nouveaux arrivants.** Avatar définitif, même si l'émetteur re-toggle. | Le nouvel arrivant est l'unique offerer (`:641-651`) et son offer ne contient aucune m-line vidéo. Le pair existant fait `addTrack` mais n'émet aucune offer ; `negotiationneeded` est levé par le navigateur et **personne ne l'écoute**. Les toggles ultérieurs passent par `replaceTrack` et ne renégocient pas non plus. |
| V2 | 🟠 | `client/src/store/voice.ts:641-645`, `:397-411` vs `server/src/handlers/websocket.rs:766-770` | Même quand la vidéo arrive, la tuile reste sur l'avatar tant que l'émetteur ne re-toggle pas caméra/mute. Idem pour l'icône « partage en cours ». | `VOICE_EXISTING_PEERS` fournit `p.video` / `p.screen`, mais `_createPC` ne transmet que `username/avatar/discriminator/muted` → `videoEnabled: false`. Corrigé seulement au prochain `VOICE_STATE_UPDATE`. |
| V3 | 🟠 | `client/src/store/voice.ts:356-370` | Une micro-coupure réseau > 4 s **supprime définitivement** un participant pour l'autre (tuile disparue, plus d'audio), alors qu'il figure toujours dans la sidebar. Irrécupérable sans quitter/rejoindre. | Sur `disconnected` persistant, la PC est fermée et retirée des Maps **sans aucune tentative de re-offer**. `restartIce` n'existe que sur `failed` (`:371-391`). Le serveur ne réémet pas `VOICE_USER_JOINED` pour un pair déjà présent. |
| V4 | 🟠 | `client/src/store/call.ts:198-201` vs `:190-193` | Appels DM qui « sonnent » puis restent muets, de façon intermittente, surtout en NAT strict. | `_pendingCandidates` n'est vidangé que dans la branche **offer**. Côté **appelant** (qui reçoit une answer), tous les candidats ICE précoces sont **perdus**. |
| V5 | 🟡 | `client/src/store/call.ts:321-328` | En appel DM, « couper la caméra » **laisse la LED webcam allumée** et la caméra occupée pour les autres applications. | `toggleCam` ne fait que `videoTrack.enabled = false` ; aucun `stop()` ni `replaceTrack(null)`, contrairement à `voice.ts:814`. |
| V6 | 🟡 | `client/src/store/voice.ts:285-288` | Rarement : pair sans audio/vidéo, ou audio en double, PC fantôme qui continue d'émettre le micro. | Garde de réentrance placée **avant** l'`await _getIceConfig()` : `_createPC` n'est pas atomique. Deux déclencheurs concurrents créent deux PC ; la première est écrasée dans `_pcs` et jamais `close()`. |
| V7 | 🟡 | `client/src/store/voice.ts:683-706` (absence de `makingOffer`) | Caméra ou partage qui « ne part pas » chez un pair, avec un `console.warn`. PC figée jusqu'au prochain événement. | Détection de glare basée uniquement sur `signalingState === 'have-local-offer'`. Entre `createOffer()` et `setLocalDescription()` l'état est encore `stable` : l'offer distante est appliquée, puis notre `setLocalDescription` lève `InvalidStateError` — avalé par `_warn`, **aucun retry**. |
| V8 | 🟡 | `client/src/store/voice.ts:707-711` | Un pair reste indéfiniment sans média dans un sens, sans erreur visible. | Une `answer` reçue hors de l'état `have-local-offer` est ignorée **sans `else` ni log** ; aucun timeout, aucune re-offer. |
| V9 | 🟡 | `client/src/components/settings/VideoSection.tsx:54-58`, `:153-160` | Réglages → Vidéo → « Aperçu » : cadre **noir au premier clic**. La caméra tourne (LED allumée) sans rendu. | `videoRef.current` est `null` au moment de l'affectation : le `<video>` n'est monté qu'une fois `previewActive === true`, or `srcObject` est assigné **avant** `setPreviewActive(true)`. Le `if (videoRef.current)` avale l'échec. |
| V10 | 🟡 | `client/src/store/voice.ts:330-338` | Inversion caméra/écran : l'écran d'un pair s'affiche dans sa tuile caméra et inversement, pour toute la session. | `_camStreamId` s'ancre sur le **premier** `stream.id` reçu, quel qu'il soit. Si la première piste est l'écran (pair sans audio) ou si `e.streams[0]` est absent (fallback `new MediaStream([e.track])`), l'ancre est fausse et n'est **jamais réévaluée**. |
| V11 | 🟡 | `client/src/store/call.ts:120-134`, `:189` | Appel DM qui ne se rétablit jamais après une perte réseau prolongée. | Les deux pairs passent en `failed` et envoient chacun une offer `iceRestart` ; `call.ts:189` applique l'offer entrante **sans contrôle d'état ni rollback** (aucun mécanisme poli/impoli côté DM). |
| V12 | 🟡 | `client/src/store/voice.ts:554-557`, `:726` | Double-clic rapide sur « Rejoindre » : listeners WS `VOICE_SIGNAL` en double, signaux traités deux fois. | `join()` n'est protégé que par `cur.joined`, positionné **après** l'`await getUserMedia`. `_offFns` est écrasé par la 2e invocation : les handlers de la 1re ne sont jamais désabonnés. |
| V13 | 🟠 | Structurel — `voice.ts:87`, `:579`, `:827` ; 0 occurrence de `setParameters` / `maxBitrate` / `sendEncodings` / `degradationPreference` / `scaleResolutionDownBy` dans `client/src` | Au-delà de 5-6 caméras, tout le monde sature : CPU à fond, images saccadées, son qui hache. | Mesh N-à-N : `N-1` encodages **indépendants** 720p30 (~2-2,5 Mb/s chacun), aucun plafond de débit, aucun simulcast, aucune dégradation automatique. 10 participants ≈ 20 Mb/s montants et 9 encodeurs. |

**Estimation de charge mesh actuelle** (720p30 ≈ 2-2,5 Mb/s) :

| Participants | PC par client | Flux vidéo émis | Upload requis |
|---|---|---|---|
| 5 | 4 | 4 | 8-10 Mb/s, 4 encodeurs |
| 10 | 9 | 9 | 20-22 Mb/s, 9 encodeurs (CPU saturé sur portable) |
| 20 | 19 | 19 | 45-50 Mb/s — irréaliste |

### 4.3 Bloc S — Partage d'écran / « Go Live »

| ID | Sév. | Fichier:ligne | Symptôme utilisateur | Cause racine |
|---|---|---|---|---|
| S1 | 🔴 | = **V1** | **L'ami qui rejoint après le début du stream ne le voit jamais.** C'est la plainte principale. | Voir V1. |
| S2 | 🟠 | `server/src/handlers/websocket.rs:329-376` (`cleanup_voice`) · `client/src/store/voice.ts:484-494`, `:737-774` | **Stream fantôme** : badge LIVE rouge et « X est en live » persistants après un crash, une fermeture d'onglet, ou quand on quitte le vocal sans avoir cliqué « Arrêter le partage ». | `cleanup_voice` n'émet **jamais** `STREAM_END` ; le handler client `VOICE_USER_LEFT` ne purge pas `activeStreams` ; `leave()` n'envoie pas `VOICE_STATE screen=false` avant `VOICE_LEAVE`. |
| S3 | 🟠 | `desktop/src-tauri/src/lib.rs:153-167` · `client/src/store/voice.ts:911-920` | Sur le desktop **Linux** (deb/appimage), cliquer « Partager l'écran » **ne fait strictement rien** : ni partage, ni erreur, ni toast. | WebKitGTK refuse la capture faute de handler `permission-request` / portail xdg ; le `NotAllowedError` renvoyé est traité comme « l'utilisateur a annulé le picker » et ignoré en silence. |
| S4 | 🟠 | `client/src/components/modals/RolesTab.tsx:85` · `ChannelSettingsModal.tsx:37` · 0 occurrence de `STREAM` dans `server/src/**` hors `STREAM_START`/`STREAM_END` | La permission **« Partager l'écran / Go Live » (bit 40) n'est jamais vérifiée** : n'importe quel membre peut streamer, permission retirée ou non. | Permission déclarée côté UI, aucun gating serveur ni client. |
| S5 | 🟠 | `client/src/components/settings/KeybindingsSection.tsx:11` vs `VoiceVideoPage.tsx:422-440` | Le raccourci configurable « Partager l'écran » (défaut `Ctrl+Alt+S`) est un **placebo**. Le seul raccourci réel est un `S` **nu**, en dur, actif uniquement sur la page vocale, qui entre en conflit avec toute autre touche `S`. | Rien ne lit `['keybindings']` hors de l'écran de configuration. |
| S6 | 🟡 | `client/src/store/voice.ts:865-868` | Partager **une fenêtre** (le cas « mon jeu ») → **aucun son transmis**, sans le moindre avertissement. Partager l'onglet ForgeChat → effet miroir infini. | `getDisplayMedia({ video: {...}, audio: true })` sans `systemAudio: 'include'`, `selfBrowserSurface: 'exclude'`, `surfaceSwitching: 'include'` ; aucune détection de `getAudioTracks().length === 0`. |
| S7 | 🟡 | `client/src/store/voice.ts:888-901` | Un pair précis ne reçoit jamais l'écran, sans message. | Si la PC n'est pas `stable` au moment du `shareScreen`, `createOffer` lève → `_warn` → **aucun retry, aucune file d'attente de renégociation**. |
| S8 | 🟡 | `client/src/components/layout/ChannelSidebar.tsx:1051-1062` | « Regarder le live de X » ne fait que naviguer vers le canal et affiche le lobby « Rejoindre le vocal ». **Pas de mode spectateur** : impossible de regarder sans ouvrir son micro. | Le bouton appelle `nav()`, jamais `join()`. Le mode `listenOnly` existe (`voice.ts:563-565`) mais n'est câblé que pour les Stage. |
| S9 | 🟡 | `client/src/components/voice/FloatingCallPiP.tsx` — 0 occurrence de `requestPictureInPicture` / `documentPictureInPicture` dans `client/src` | La miniature **disparaît dès que ForgeChat perd le focus ou est minimisé** — exactement le cas d'usage « je regarde le stream en jouant ». | La vignette est une `div` CSS fixe (`bottom-4 right-4`), pas une vraie PiP OS. Ni déplaçable, ni redimensionnable, sans bouton « arrêter le partage ». |
| S10 | 🟡 | `client/src/store/voice.ts:866` · 0 occurrence de `contentHint` | Texte illisible sur du contenu statique, ou saccades sur du jeu, selon l'heuristique de l'encodeur. Aucun réglage de qualité exposé. | Résolution figée `ideal 1920×1080@30`, `contentHint` jamais posé, aucun plafond de débit. |
| S11 | 🟡 | `client/src/store/voice.ts:240-276` | L'audio du jeu est **mixé dans la piste micro** : couper son micro coupe aussi le son du jeu pour les viewers. Volume du jeu et de la voix non dissociables. | Choix d'architecture assumé (`voice.ts:236-239`) : un seul sender audio, `replaceTrack` avec le mix. |
| S12 | 🟢 | `desktop/src-tauri/src/lib.rs:153-155` | Commentaire affirmant que `--use-fake-ui-for-media-stream` « accorde micro/caméra/**écran** sans prompt ». **Faux pour l'écran** (ce serait `--auto-select-desktop-capture-source`). | Hypothèse non vérifiée, donne un faux sentiment de couverture. |
| S13 | 🟢 | `FEATURE_BACKLOG.md:78` | « Partage écran/app robuste — vérifié, pas de changement nécessaire » coché ✅ alors que S1, S2, S6 sont dans ce périmètre exact. | Vérification faite sur la seule existence de `getDisplayMedia`. |
| S14 | 🟢 | — (absence) | Aucun compteur de spectateurs, aucun aperçu de ce que voient les autres, aucun self-monitoring du son partagé. | Non implémenté. |

### 4.4 Bloc N — Signalisation, état serveur, infrastructure

| ID | Sév. | Fichier:ligne | Symptôme utilisateur | Cause racine |
|---|---|---|---|---|
| N1 | 🔴 | `ChannelSidebar.tsx:315-318` · `websocket.rs:361` · `voice.ts:556-557`, `:630` | **Les canaux vocaux « auto-create » sont inutilisables** : le canal temporaire est créé puis immédiatement supprimé, l'utilisateur finit hors de tout canal, micro ouvert, `joined=true` côté UI, zéro entrée serveur, aucun message. | `VOICE_REDIRECT` déclenche un `join(T)` qui appelle `leave()` d'abord → `cleanup_voice` voit la room vide → `DELETE FROM channels WHERE id=T AND is_temporary=TRUE` → le `VOICE_JOIN{T}` suivant échoue sur le contrôle d'appartenance et **retourne en silence**. |
| N2 | 🔴 | `client/src/store/ws.ts:142` (aucun consommateur dans `voice.ts` / `call.ts`) | Après **toute** reconnexion WS, l'utilisateur est invisible pour les autres et n'entend plus les nouveaux arrivants, alors que son UI affiche « connecté au vocal ». | Aucun re-`VOICE_JOIN` / `VOICE_STATE` / `STAGE_JOIN` sur `onOpen` (seuls `App.tsx:214` et `ChannelPage.tsx:158` l'utilisent). Le serveur a exécuté `cleanup_voice` entre-temps. |
| N3 | 🔴 | `server/src/state.rs:58-71` · `deploy.sh:58` | **Chaque déploiement vide tous les salons vocaux** sans notification ni reconnexion. Les pairs déjà appairés continuent en P2P, mais plus personne ne peut les rejoindre et leurs `VOICE_STATE` sont rejetés. | État vocal 100 % en mémoire process (`voice_rooms`, `user_voice`, `voice_states`), aucune persistance, combiné à N2. |
| N4 | 🟠 | `client/src/store/ws.ts:127-132` | Un ICE candidate ou une answer émis pendant une micro-coupure WS **disparaît** → appel qui ne s'établit jamais, sans trace. | `send()` est un no-op silencieux si `readyState !== OPEN`. Aucune file d'attente. |
| N5 | 🟠 | `server/src/state.rs:13`, `:30`, `:168-183` · `websocket.rs:78-87` | **Deux onglets cassent tout** : les pairs distants ne voient qu'un seul `user_id` (un seul PC → écho/glare, un onglet jamais appairé) ; `VOICE_LEAVE` depuis l'onglet 2 éjecte l'onglet 1 ; `DM_CALL_INCOMING` sonne dans les deux et une seule modale s'éteint. | Tout l'état est clé par `user_id`, jamais par connexion/session. |
| N6 | 🟠 | `server/src/handlers/voice.rs:23-33` · `config.rs:47-49` | Le secret TURN est distribué **en clair à tout compte authentifié**, sans expiration. Le relais est exploitable hors ForgeChat, indéfiniment. | Credentials statiques renvoyés tels quels ; pas de TURN REST API / HMAC éphémère. Aggravé par un cache client sans invalidation (`voice.ts:116`, `call.ts:20`). |
| N7 | 🟠 | `.env.example:1-13` vs `docker-compose.yml:41-43` | Un déploiement neuf part en **STUN-only** : appels muets derrière NAT strict, zéro alerte. | `TURN_URL` / `TURN_USERNAME` / `TURN_PASSWORD` absents de `.env.example`, défaut vide, aucun healthcheck TURN. Rappel : un défaut TURN silencieux a déjà coûté ~7 itérations (`/etc/turnserver.conf` illisible par le process). |
| N8 | 🟠 | `server/src/models/role.rs:55-56` vs `websocket.rs:649-658` | N'importe quel membre du serveur peut entrer dans un canal vocal censé être restreint. | `CONNECT_VOICE` (1<<13) et `SPEAK_VOICE` (1<<14) sont définis et **jamais vérifiés** ; `VOICE_JOIN` ne teste que `server_members` et ignore `channel_permissions`. |
| N9 | 🟠 | `websocket.rs:917-948` et tous les handlers vocaux | Un client malveillant peut noyer un pair sous des SDP/ICE, ou spammer le soundboard/whiteboard de tout un serveur. | **Aucun rate limit** sur `VOICE_SIGNAL`, `VOICE_STATE`, `VOICE_JOIN`, `HAND_RAISE`, `SOUNDBOARD_PLAY`, `VOICE_REACTION`, `WHITEBOARD_*`. Seules limites existantes : taille 64 KiB, et Redis pour `TYPING_START` / `DM_CALL_INIT`. |
| N10 | 🟡 | `websocket.rs:337`, `:797`, `:888`, `:905`, `:913` via `:413-420` | Chaque mute/unmute d'un inconnu est poussé à **tous les clients de l'instance**, avec pseudo et avatar. Fuite de présence inter-serveurs + charge O(n) par toggle. | `broadcast_to_all` au lieu d'un ciblage par serveur/canal. |
| N11 | 🟡 | `server/src/main.rs:688` (seule route vocale) · `voice.ts:459` | Après un F5, **tous les canaux vocaux de la sidebar apparaissent vides** et les badges LIVE disparaissent, jusqu'au prochain join/leave de quelqu'un. | Aucun endpoint REST de bootstrap ; seul `PRESENCE_INIT` est poussé à la connexion. |
| N12 | 🟡 | `websocket.rs:523` vs absence de `on('HEARTBEAT_ACK')` dans `client/src` | Socket « half-open » (NAT/proxy qui oublie le flux sans FIN) **jamais détectée** : l'utilisateur croit être en vocal, plus rien n'arrive. | `HEARTBEAT_ACK` est émis mais écouté nulle part ; aucun watchdog dans `ws.ts`. |
| N13 | 🟡 | `websocket.rs:1316-1340` | Une main levée reste levée après le départ de son auteur ; un arrivant ne voit aucune main déjà levée. | `HAND_RAISE` vocal est un pur relais, sans état serveur ni cleanup (contrairement à `STAGE_HAND_RAISE`, `state.rs:191-210`). |
| N14 | 🟡 | `server/src/state.rs:122-135` vs `channels.rs:417` | Les traits de tableau blanc, sons et réactions d'un canal **privé** sont diffusés à tous les membres du serveur. | `broadcast_to_channel_members` résout channel→server et ignore `channel_permissions`. |
| N15 | 🟡 | `server/src/handlers/websocket.rs` (global) | Impossible de diagnostiquer un appel qui coupe : les rejets d'autorisation et les `return` silencieux ne loguent rien, aucune métrique WebRTC n'est remontée. | Zéro instrumentation vocale ; `getStats` n'existe que pour l'icône de qualité locale (`VoiceVideoPage.tsx:60`), jamais remontée. |
| N16 | 🟢 | `ChannelSidebar.tsx:310` vs `websocket.rs:739-744` | Toast `Canal plein (undefined/6 places)`. | Le client lit `d.current`, le serveur n'envoie que `channel_id/reason/limit`. |
| N17 | 🟢 | `websocket.rs:1126-1149` | Un arrivant en cours de session voit un tableau blanc vide. | Aucune persistance whiteboard/soundboard (design assumé, signalé au journal `2602-2609`, jamais traité). |
| N18 | 🟢 | `voice.ts:120-126` vs `call.ts:15-18` | Deux fallbacks STUN divergents (3 serveurs vs 2) et deux caches ICE séparés ; `ice-config` en erreur = perte silencieuse du TURN. | Duplication du chemin de config ICE entre les deux stores. |
| N19 | 🟢 | `call.ts:272-276` vs `websocket.rs:235` | Divergence cosmétique du timeout de sonnerie (45 s client, 50 s serveur documenté). | Deux constantes non partagées. |

### 4.5 Récapitulatif

| Bloc | 🔴 | 🟠 | 🟡 | 🟢 | Total |
|---|---|---|---|---|---|
| A — Audio | 4 | 6 | 9 | 5 | 24 |
| V — Vidéo/négociation | 1 | 4 | 8 | 0 | 13 |
| S — Stream | 1 | 4 | 6 | 3 | 14 |
| N — Serveur/infra | 3 | 6 | 6 | 4 | 19 |
| **Total** (hors doublon S1=V1) | **8** | **20** | **29** | **12** | **69 → 61 uniques** |

---

## 5. Fonctionnalités à implémenter

### F1 — Suppression de bruit de niveau Krisp

**Problème** : la chaîne actuelle est un noise gate RMS maison (`noise-gate-worklet.js`, seuil fixe 0,02, atténuation −22 dB) en cascade avec l'AGC et la NS du navigateur. Elle ne supprime pas les bruits stationnaires (ventilateur, climatisation) ni les bruits transitoires (clavier, chien, voix hors champ). Elle produit du pompage (A20) et meurt au deuxième salon (A1).

**Cible** : moteur de débruitage par réseau de neurones exécuté en WASM dans un `AudioWorklet`, avec sélection du niveau par l'utilisateur.

| Niveau | Traitement | CPU cible |
|---|---|---|
| Désactivé | Piste brute, EC navigateur seul | 0 % |
| Standard | EC + NS + AGC navigateur + highpass 85 Hz | < 1 % |
| Élevé (défaut) | RNNoise WASM (48 kHz, trames 480 échantillons) + highpass + limiteur doux | 3-6 % d'un cœur |
| Maximum | DeepFilterNet3 WASM (ou RNNoise ×2 passes selon décision D2) | 10-15 % d'un cœur |

**Exigences** :
1. Le moteur tourne dans un `AudioWorkletProcessor` dédié, jamais sur le thread principal.
2. Le module WASM est chargé une fois **par `AudioContext`**, avec un cache **clé par contexte** — correctif structurel de A1. Toute fermeture de contexte invalide l'entrée correspondante.
3. Échec de chargement → repli explicite sur le niveau « Standard » **et** notification visible à l'utilisateur (pas de repli silencieux sur le flux brut).
4. Réglage appliqué **à chaud** sans rejoindre le salon, et **sans jamais réactiver un micro coupé** (correctif A2 : l'état `muted` est réappliqué après tout `replaceTrack`).
5. Le même traitement s'applique aux **appels DM** (correctif A7) : `call.ts` doit consommer la même fonction de construction de chaîne que `voice.ts`.
6. Détection de voix (VAD) fournie par le moteur, réutilisée pour l'indicateur « parle » — supprime les 2+N+3 `AudioContext` concurrents (correctif A10) et les re-renders à 12,5 Hz (correctif A11).
7. Page Réglages → Audio : bouton « Tester », enregistrement de 5 s, lecture A/B avant/après, affichage de la charge CPU mesurée.

**Ce qui est explicitement écarté** : Krisp lui-même (SDK propriétaire, licence commerciale par siège) ; un traitement côté serveur (incompatible avec le P2P chiffré et multiplierait la latence).

### F2 — Push-to-talk réel

- Câbler `setPttMode` depuis Réglages → Voix (correctif A8) ; trois modes exclusifs : Voix (VAD), Push-to-talk, Toujours ouvert.
- Lire les keybindings persistés (`/user/keybindings`) au lieu du `P`/`Espace` codé en dur.
- Listeners montés au niveau racine (`App.tsx`), pas dans `VoiceVideoPage`, avec test de `e.repeat`.
- Desktop : ajouter `tauri-plugin-global-shortcut` pour un PTT actif **fenêtre non focalisée** (correctif A9).
- `activatePtt` / `deactivatePtt` doivent appeler `_broadcastState` : les autres voient l'état réel.
- Délai de relâchement configurable (défaut 200 ms) pour ne pas couper les fins de mot.

### F3 — Contrôle du son par utilisateur

- Monter `VolumeSlider` dans le menu contextuel de chaque tuile et de chaque entrée de la sidebar vocale (correctif A14).
- Persister `userVolumes` en `localStorage`, clé par `user_id`, survivant à `leave()` (correctif A15).
- Ajouter « Couper cet utilisateur pour moi » (mute local), distinct du mute serveur.
- Corriger le deafen : coupe aussi le micro local et l'audio d'un appel DM simultané (correctif A21).

### F4 — Le stream que l'ami voit vraiment

C'est la demande centrale. Quatre exigences :

1. **Tout arrivant reçoit le stream en cours** — correctif V1/S1 : handler `onnegotiationneeded` + reprise des flags `video`/`screen` de `VOICE_EXISTING_PEERS` (V2).
2. **Le retour audio fonctionne** :
   - `getDisplayMedia({ audio: { systemAudio: 'include' }, video: { displaySurface: 'monitor' }, selfBrowserSurface: 'exclude', surfaceSwitching: 'include' })` (correctif S6).
   - Si `getAudioTracks()` est vide après un partage de fenêtre : bandeau explicite « Cette fenêtre ne peut pas partager son son — choisissez l'écran entier ou un onglet » (aujourd'hui : silence total, aucun indice).
   - **Piste audio séparée** pour le son du jeu au lieu du mix dans le micro (correctif S11 et A17) : un second `RTCRtpSender` audio, `contentHint = 'music'`, volume dissociable côté viewer, et couper son micro ne coupe plus le jeu.
   - Self-monitoring optionnel : case « M'entendre » avec avertissement de larsen.
3. **Le stream survit à la navigation** — déjà vrai grâce aux singletons de module ; à verrouiller par un test de non-régression (10 navigations serveur → serveur pendant un stream actif).
4. **Miniature persistante** — correctif S9 :
   - `documentPictureInPicture` (Chromium 116+) quand disponible : la vignette reste visible **même ForgeChat minimisé**, avec contrôles micro/caméra/arrêt du partage.
   - Repli `requestPictureInPicture` sur l'élément `<video>` du stream.
   - Repli final : la `div` flottante actuelle, rendue déplaçable et redimensionnable, avec bouton « Arrêter le partage ».
   - La vignette doit apparaître **aussi** quand on regarde le stream d'un autre, pas seulement le sien.

### F5 — Mode spectateur

- « Regarder le live de X » rejoint le canal en `listenOnly` (aucun `getUserMedia`, `addTransceiver` recvonly) — correctif S8, le mécanisme existe déjà pour les Stage.
- Compteur de spectateurs diffusé avec `STREAM_START` et tenu à jour.
- Bouton « Activer mon micro » pour passer spectateur → participant sans quitter le canal.

### F6 — Qualité configurable et adaptative

- Réglages → Vidéo et Réglages → Stream : résolution (720p / 1080p / source), fréquence (30 / 60), débit maximum (1 / 2,5 / 5 / 8 Mb/s), preset « Fluidité » vs « Netteté » → `contentHint = 'motion' | 'detail'`.
- `sender.setParameters` avec `maxBitrate` et `degradationPreference` sur tous les senders (correctif V13, S10).
- `CallQualityIndicator` devient **actionnable** : au-delà d'un seuil de `fractionLost`, dégradation automatique de la résolution et bandeau « Qualité réduite : réseau instable » (aujourd'hui l'icône est purement décorative).
- Changement de micro/caméra **à chaud** par `getUserMedia` + `replaceTrack` sur tous les senders (correctif A13).

### F7 — Robustesse réseau et état serveur

- **Re-synchronisation sur `onOpen`** : `voice.ts` et `call.ts` s'abonnent à `ws.onOpen` et renvoient `VOICE_JOIN` + `VOICE_STATE` (correctif N2/N3).
- **File d'attente WS** : les messages émis hors `OPEN` sont mis en file et rejoués à la reconnexion, avec TTL (les candidats ICE périmés sont jetés plutôt qu'envoyés) — correctif N4.
- **Watchdog heartbeat** : écouter `HEARTBEAT_ACK`, forcer la reconnexion après 2 ACK manqués (correctif N12).
- **Persistance Redis** de l'état vocal (`voice_rooms`, `voice_states`, `stage_*`) avec TTL et reconstruction au démarrage (correctif N3). Redis est déjà dans la stack.
- **Clé par session**, pas par `user_id` : `session_id` par connexion WS, plusieurs onglets coexistent proprement, `DM_CALL_TAKEN` éteint les modales des autres onglets (correctif N5).
- **Bootstrap REST** : `GET /api/voice/state` renvoyant les participants et les streams actifs des serveurs de l'utilisateur, appelé au montage (correctif N11).
- **Correctif N1** : ne pas `leave()` avant un `join()` vers le canal de redirection ; comparer `VOICE_EXISTING_PEERS` au canal **effectif** ; ne pas supprimer un canal temporaire dans la fenêtre de redirection (grâce de quelques secondes).

### F8 — Sécurité et exploitation

- **Credentials TURN éphémères** (TURN REST API, HMAC-SHA1, TTL 1 h) au lieu du secret statique partagé (correctif N6) ; invalidation du cache client à l'expiration.
- `TURN_URL` / `TURN_USERNAME` / `TURN_PASSWORD` **documentés dans `.env.example`** et **healthcheck TURN dans `deploy.sh`** qui échoue bruyamment si le relais ne répond pas (correctif N7 ; rappel : cette panne a déjà coûté ~7 itérations et n'était visible que dans `/var/log/turnserver/turn_<pid>.log`).
- Vérification de `CONNECT_VOICE` / `SPEAK_VOICE` dans `VOICE_JOIN`, et de `STREAM` (bit 40) avant tout `STREAM_START` (correctifs N8, S4).
- Rate limit Redis sur `VOICE_SIGNAL` (par paire), `VOICE_STATE`, `VOICE_JOIN`, `HAND_RAISE`, `SOUNDBOARD_PLAY`, `WHITEBOARD_*` (correctif N9).
- Ciblage des broadcasts vocaux par serveur/canal au lieu de `broadcast_to_all` (correctifs N10, N14).

### F9 — Observabilité

- `getStats()` échantillonné toutes les 10 s, agrégé côté client (RTT, jitter, perte, bitrate, résolution, codec) et envoyé sur un endpoint `POST /api/voice/telemetry` échantillonné.
- Logs `tracing` sur chaque `VOICE_JOIN`/`LEAVE`/`SIGNAL` **rejeté**, avec le motif (aujourd'hui : `return` muets, invisibles).
- Page « Diagnostic vocal » masquée (`/settings/voice-debug`) : état ICE par pair, chemin sélectionné (host/srflx/relay), débits temps réel, dernier SDP — de quoi diagnostiquer sans harnais Playwright externe.

---

## 6. Lots de livraison

Ordonnés par dépendance et par ratio impact/effort. Chaque lot est déployable seul.

### Lot 0 — Hotfix vie privée et sécurité immédiate (0,5 j)

`A4` (micro ouvert après leave), `A2` (mute contourné par le toggle NS), `A3` (larsen plein écran), `A5`/`A6` (double audio), `V5` (LED webcam DM), `N16` (toast undefined).

> Critère : après `leave()`, `navigator.mediaDevices` ne détient plus aucune piste active — vérifié par l'indicateur OS et par `getTracks().every(t => t.readyState === 'ended')`.

### Lot 1 — Négociation WebRTC (1,5 j) — **le plus gros rendement**

`V1`/`S1` (`onnegotiationneeded` + file de renégociation sérialisée par pair), `V2` (flags des pairs existants), `V3` (re-offer au lieu de suppression après `disconnected`), `V7` (`makingOffer`), `V8` (answer hors état : log + re-offer), `V6` (atomicité `_createPC`), `V12` (double join), `S7` (retry de partage), `V10` (identification caméra/écran par transceiver `mid` signalé, au lieu du `msid` deviné).

> Critères : un pair qui rejoint un appel où caméra **et** partage sont déjà actifs voit les deux en < 3 s ; une coupure réseau de 10 s se rétablit sans action ; 20 cycles caméra on/off sans perte de média.

### Lot 2 — Parité DM (1 j)

`A7` (micro choisi + NS en DM), `V4` (drain ICE côté appelant), `V11` (glare DM), `A21` (deafen), `N18`/`N19` (config ICE et constantes partagées). Extraction d'un module `webrtc/peer.ts` commun à `voice.ts` et `call.ts` pour les parties identiques (config ICE, file ICE, glare, ICE restart) — sans toucher aux deux formats de payload WS, documentés comme intouchables.

### Lot 3 — Stream et miniature (2 j)

`S2` (fantômes), `S6` (audio système, exclusion de l'onglet ForgeChat), `S11` (piste audio dédiée), `S9` (PiP document), `S8`/`F5` (mode spectateur + compteur), `S10` (`contentHint` + débit), `S3`/`S12` (capture desktop Linux + correction du commentaire), `S5` (raccourci réel), `S4` (permission `STREAM`).

> Critères : l'ami voit le stream et **entend le jeu** en partage d'écran entier comme en partage de fenêtre (ou reçoit un message explicite) ; la vignette reste visible ForgeChat minimisé ; aucun badge LIVE fantôme après `kill -9` du client.

### Lot 4 — Suppression de bruit (2 j)

`F1` complet, `A1`, `A12`, `A19`, `A20`, `A10`, `A11`, `A22` (VAD unifiée issue du moteur), `A13`/`A16` (changement de périphérique à chaud), `A18` (autoplay), `A23`, `A24`.

> Critères : atténuation ≥ 20 dB d'un bruit de ventilateur mesurée sur enregistrement A/B ; NS active au 5e salon rejoint de la session ; CPU < 6 % d'un cœur au niveau Élevé.

### Lot 5 — Robustesse serveur et infra (2 j)

`N1`, `N2`, `N3`, `N4`, `N5`, `N11`, `N12`, `N13`, `N6`, `N7`, `N8`, `N9`, `N10`, `N14`, `N15`, `F9`.

> Critères : `deploy.sh` en pleine réunion à 4 → tout le monde est re-synchronisé en < 10 s, sans action ; deux onglets du même compte dans le même salon ne cassent plus l'appariement.

### Lot 6 — Scalabilité (effort selon décision D1)

`V13`, `F6`. Voir §9.

### Lot 7 — Confort (0,5 j)

`F2` (PTT), `F3` (volumes), `A16`, `A23`, `N17`, `S13`/`S14`.

**Total hors Lot 6 : ~9,5 jours-homme.**

---

## 7. Plan de vérification

Tout correctif est vérifié **en conditions réelles, deux comptes réels sur le VPS**, jamais sur la seule lecture du code. Le harnais existant (`D:\Projet\forgechat-loop\tests\`, Playwright avec `addInitScript` qui enveloppe `RTCPeerConnection` et `WebSocket`) est réutilisé et étendu.

| # | Scénario | Attendu |
|---|---|---|
| T1 | A rejoint, active sa caméra, **puis** B rejoint | B voit la caméra de A en < 3 s |
| T2 | A partage son écran, **puis** B rejoint | B voit le stream **et entend le son du jeu** |
| T3 | A partage une **fenêtre** de jeu | Son transmis, ou bandeau explicite si le navigateur ne le permet pas |
| T4 | A streame, B navigue vers un autre serveur, ouvre un DM, revient | Le stream de A n'est jamais interrompu ; B garde une miniature à l'écran |
| T5 | A streame, B minimise ForgeChat | La miniature reste visible (PiP document) |
| T6 | A coupe son micro puis bascule le toggle « Suppression de bruit » | Le micro **reste** coupé |
| T7 | A quitte le salon | L'indicateur micro de l'OS s'éteint immédiatement |
| T8 | A rejoint 5 salons successifs dans la même session | La NS est active les 5 fois (mesure du bruit résiduel) |
| T9 | Coupure réseau de 10 s sur B | B réapparaît chez A sans action, audio et vidéo rétablis |
| T10 | `deploy.sh` pendant un appel à 4 | Les 4 sont re-synchronisés en < 10 s |
| T11 | A ouvre un 2e onglet et rejoint le même salon | Aucun écho, aucune éjection de l'onglet 1 |
| T12 | A ferme son onglet brutalement pendant un stream | Le badge LIVE disparaît chez tous en < 5 s |
| T13 | Appel vidéo DM affiché sur `DMPage` | Une seule source audio, pas de doublement |
| T14 | PTT en jeu plein écran (desktop Windows) | La touche transmet même sans focus sur ForgeChat |
| T15 | Appel à 6 avec caméras, 30 min | Aucune coupure > 500 ms ; débit montant plafonné à la valeur configurée |
| T16 | TURN volontairement cassé (`chmod 600 root:root` sur `turnserver.conf`) | `deploy.sh` échoue bruyamment, un message clair remonte |

---

## 8. Métriques de succès

| Métrique | Aujourd'hui | Cible |
|---|---|---|
| Arrivants tardifs voyant un stream en cours | 0 % | 100 % |
| Sessions NS fonctionnelles par session navigateur | 1re seulement | toutes |
| Participants fantômes après déploiement | tous | 0 |
| Coupures audio > 500 ms sur 30 min à 4 | non mesuré | < 1 |
| Charge CPU client en vocal à 4 sans vidéo | non mesuré (~250 re-renders/s) | < 8 % d'un cœur |
| Fonctionnalités exposées sans implémentation | 5 (PTT, raccourci stream, permission STREAM, VolumeSlider, whisper) | 0 |
| Temps de diagnostic d'un appel qui coupe | heures (harnais externe) | minutes (page de diagnostic) |

---

## 9. Décisions ouvertes (à trancher par Momo)

### D1 — Mesh P2P ou SFU ?

| Option | Pour | Contre |
|---|---|---|
| **A. Rester en mesh + garde-fous** (plafond de débit, simulcast impossible, limite dure de participants vidéo, dégradation auto) | Aucun changement de stack, aucun serveur média à exploiter, ~1,5 j | Plafond structurel à 5-6 caméras ; un stream 1080p coûte N × son débit en montée ; impossible d'enregistrer ou de transcoder plus tard |
| **B. Introduire un SFU** (LiveKit, ou mediasoup) | Charge montante constante quel que soit N ; simulcast et couches de qualité ; 20+ participants ; base pour enregistrement et mode spectateur massif | Nouveau service à déployer et surveiller sur le VPS (CPU, ports UDP, TLS) ; réécriture du transport de `voice.ts` (~5-7 j) ; le relais devient un point de panne unique |

**Recommandation** : **A pour les lots 0-5, B ensuite si l'usage réel dépasse régulièrement 6 caméras.** Les 61 défauts recensés sont presque tous indépendants de la topologie : les corriger en mesh donne un produit fiable à 2-6, qui est l'usage décrit. Basculer en SFU avant de les corriger reporterait les mêmes bugs dans une architecture neuve.

### D2 — Quel moteur de suppression de bruit ?

| Option | Qualité | CPU | Taille | Licence |
|---|---|---|---|---|
| **A. RNNoise WASM** | Très bonne sur bruit stationnaire et clavier ; référence de facto de l'open source | 3-6 % d'un cœur | ~120 Ko | BSD 3-Clause |
| **B. DeepFilterNet3 WASM** | Meilleure sur bruits complexes et voix hors champ, plus proche de Krisp | 10-15 % d'un cœur | ~2 Mo | MIT / Apache-2.0 |
| **C. Les deux, au choix de l'utilisateur** | Couvre les deux profils de machine | selon le niveau | ~2,1 Mo | — |

**Recommandation** : **C**, avec RNNoise par défaut (niveau « Élevé ») et DeepFilterNet en niveau « Maximum » chargé à la demande. Le coût marginal est un second worklet ; l'architecture de cache par contexte exigée par F1 est la même dans les deux cas.

### D3 — Points mineurs à confirmer

- Faut-il **couper le micro local** au deafen (comportement Discord) ou conserver le comportement actuel ?
- Le partage d'écran doit-il être **limité par permission de rôle** (bit `STREAM` déjà présent dans l'UI) dès le lot 3, ou reste-t-il ouvert à tous ?
- Limite dure de participants **vidéo** simultanés en mesh : 6 (recommandé) ou configurable par canal ?

---

## 10. Risques

| Risque | Impact | Mitigation |
|---|---|---|
| Le handler `onnegotiationneeded` provoque une tempête d'offres sur les clients existants | Régression massive sur les appels en cours | File de renégociation sérialisée par pair + `makingOffer` (V7) livrés **dans le même lot** ; test T1/T2 avant déploiement |
| La piste audio séparée pour le stream casse les clients non mis à jour | Son du jeu perdu pendant la fenêtre de déploiement | Le sender supplémentaire est ignoré par un ancien client (il ne fait que ne pas l'afficher) ; déployer client et serveur ensemble |
| DeepFilterNet sature les machines modestes | Voix hachée, pire que sans NS | Mesure de charge dans le worklet, rétrogradation automatique vers RNNoise avec notification |
| La persistance Redis de l'état vocal introduit des incohérences | Fantômes d'un autre type | TTL court (60 s) rafraîchi par heartbeat ; la mémoire process reste la source de vérité, Redis n'est qu'un cache de reprise |
| Régression silencieuse de TURN (historique) | Appels muets en NAT strict, diagnostic long | Healthcheck TURN bloquant dans `deploy.sh` + alerte |

---

## 11. Annexe — Fonctionnalités fantômes recensées

Éléments exposés dans l'interface sans aucune implémentation derrière. À corriger ou à retirer (O7).

| Élément | Où | Réalité |
|---|---|---|
| Raccourci « Push-to-talk » (défaut Alt) | `KeybindingsSection.tsx:10` | `setPttMode` n'a aucun appelant ; PTT injoignable |
| Raccourci « Partager l'écran » (défaut Ctrl+Alt+S) | `KeybindingsSection.tsx:11` | Aucun consommateur ; seul un `S` nu en dur existe |
| Permission « Partager l'écran / Go Live » (bit 40) | `RolesTab.tsx:85`, `ChannelSettingsModal.tsx:37` | Jamais vérifiée côté serveur ni client |
| Permissions `CONNECT_VOICE` / `SPEAK_VOICE` | `role.rs:55-56` | Définies, jamais vérifiées |
| Réglage de volume par utilisateur | `VolumeSlider.tsx` (92 lignes) | Composant jamais monté |
| Mode « whisper » | `voice.ts:1034-1047` | Code mort, et bugué s'il était branché |
| Indicateur de qualité d'appel | `VoiceVideoPage.tsx:51-89` | Purement décoratif, aucune action corrective |
| Toggle « Suppression de bruit » | `AudioSection.tsx:190-203` | Ne pilote que la chaîne maison ; le `noiseSuppression: true` du navigateur reste actif quoi qu'il arrive |

---

## 12. État d'implémentation (mise à jour 2026-09-22)

Les lots 0 à 5 ont été implémentés dans la foulée de ce PRD, sur les trois cibles (web, application Windows, application Linux). Versions : serveur `3.249.0`, client `3.581.0`, desktop `3.23.0`.

### Livré

| Lot | Contenu | Vérification |
|---|---|---|
| 0 — Vie privée / sécurité | A2, A3, A4, A5, A6, V5, N16 | `tsc` + `eslint` + build client OK |
| 1 — Négociation | V1/S1 (`onnegotiationneeded` + perfect negotiation complet), V2, V3 (reprise ICE progressive au lieu de suppression du pair), V6 (création de pair atomique), V7, V8, V10 (msid d'écran signalé explicitement), V12 | `tsc`, build |
| 2 — Parité DM | A7, V4, V11, V5, A21, N18, A18 | `tsc` |
| 3 — Stream | S2, S6 (`systemAudio`/`selfBrowserSurface`/`surfaceSwitching` + avertissement si une fenêtre ne transmet pas son son), S8 (mode spectateur), S9 (Picture-in-Picture natif + bouton d'arrêt du partage dans la vignette), S10, S11 (**piste audio dédiée au son du partage**, volume indépendant du micro), S3/S12 (capture Linux câblée côté WebKitGTK), S4, S5 | `tsc`, `cargo check` (Windows + WSL2 Linux) |
| 4 — Suppression de bruit | F1 : quatre moteurs sélectionnables (porte de bruit, Speex, **RNNoise**, **GTCRN**) en AudioWorklet WASM, cache par contexte (A1), repli explicite et visible (A12), limiteur retuné (A20), AudioContext unique partagé (A10, A11, A22), périphériques à chaud (A13, A16), volumes persistés (A14, A15), autoplay (A18), sortie ciblée (A23, A24) | build, poids ~550 Ko d'assets servis depuis `/noise/` |
| 5 — Serveur / infra | N1, N2/N3 (persistance Redis), N4 (file d'émission WS), N5 (sessions), N6 (TURN HMAC éphémère), N7, N8, N9, N10, N11, N12, N13, N14, N15, N19, F9 (télémétrie) | `cargo check` + test unitaire des overrides de permission |
| 7 — Confort | F2 (push-to-talk réel, raccourcis configurés respectés, raccourci **global** sur le bureau via `tauri-plugin-global-shortcut`), F3, F6 (qualité configurable + dégradation automatique réelle sur perte de paquets) | build |

### Reste à faire

1. **Migration SQL `@everyone` += `CONNECT_VOICE | SPEAK_VOICE | STREAM`.** Les contrôles de permission vocale et de partage existent côté serveur mais sont volontairement inertes tant qu'un administrateur n'a pas posé ces bits quelque part (sinon tous les membres des serveurs existants auraient été éjectés du vocal au déploiement). Tant que la migration n'est pas faite, le gating ne s'applique qu'aux serveurs configurés.
2. **`STREAM` (bit 40) dans `models/role.rs`** — actuellement dupliqué en `state.rs::PERM_STREAM`.
3. **Lot 6 (scalabilité)** — décision D1 non tranchée : le mesh reste plafonné à ~6 caméras, désormais avec plafond de débit et dégradation automatique.
4. **Vérification en conditions réelles** : les scénarios T1 à T16 du §7 n'ont pas encore été joués à deux comptes sur le VPS. Tout ce qui précède est vérifié par compilation, typage et lint, pas par un appel réel.
5. **Paquet Linux** : `xdg-desktop-portal` (+ un backend `-gtk`/`-gnome`/`-kde`) est requis à l'exécution pour la capture d'écran ; volontairement non ajouté aux `depends` du `.deb`.
6. **Wayland** : le raccourci global de push-to-talk repose sur `XGrabKey` — inopérant en session Wayland pure.
