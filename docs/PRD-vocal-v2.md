# PRD — Vocal, vidéo et stream v2 (serveur média SFU)

Date : 2026-09-22. Remplace l'architecture pair-à-pair du PRD `PRD-vocal-video-stream.md`, dont les correctifs de fond (négociation, suppression de bruit, piste audio de partage dédiée, reprise après redémarrage) restent valables côté interface.
Recherche préalable : `RECHERCHE-vocal-v2.md` (Element Call, Stoat/Revolt, Mattermost, Rocket.Chat, Jitsi, LiveKit).

## 1. Le signalement

Deux PC réels, même box, Brave des deux côtés, salon vidéo `tchat1video`, comptes `Momo` et `momo` :

- aucun son dans les deux sens, alors que les deux micros fonctionnent ;
- la tuile de l'autre personne reste vide, le stream s'affiche en avatar ;
- les tuiles se chevauchent : celle du bas recouvre le nom de celle du haut ;
- sa propre personne n'apparaît pas sous le salon dans la barre latérale.

## 2. Ce que la mesure a établi

| Vérification | Résultat |
|---|---|
| Présence côté serveur (Redis `voice:snapshot`) | les deux comptes dans le salon : la signalisation passe |
| Télémétrie d'appel | **aucune** : elle n'était envoyée qu'une fois la connexion établie, donc jamais en panne |
| Relais TURN avec les identifiants servis | fonctionne (candidats `relay` obtenus) |
| Même scénario, Brave, deux comptes sur une machine | connecté, son et image |
| Machine sans webcam dans un salon vidéo | connecté |
| Ce PC vers un Chromium dans Docker sur le VPS (deux réseaux) | connecté en `srflx` |
| Deux machines du **même** réseau local | seul cas non reproductible en automatique, seul cas en panne |

Conclusion : le maillage pair-à-pair dépend, entre deux machines d'un même réseau, de la résolution des adresses locales masquées (mDNS) et du renvoi par la box vers le réseau local (hairpin NAT). Aucun des deux n'est garanti. C'est une limite de l'architecture, pas un bug isolé : Discord, Element Call (Matrix), Stoat (ex-Revolt), Jitsi et Mattermost utilisent tous un serveur média.

Autres mesures :

- WebKitGTK 2.50.4 d'Ubuntu : `typeof RTCPeerConnection === 'undefined'`, même avec `enable-webrtc`. **L'application Linux ne peut passer aucun appel dans sa vue web**, avec ou sans SFU.
- Pare-feu IONOS (en plus d'UFW) : UDP 50000 et 60000 passent, UDP 7882 est bloqué.
- Le curseur de volume va jusqu'à 200 %, mais `audio.volume` au-delà de 1 lève `IndexSizeError`.

## 3. Décisions

| # | Décision | Alternatives écartées |
|---|---|---|
| D1 | **SFU LiveKit auto-hébergé** (`livekit/livekit-server:v1.13.7`, SDK `livekit-client` 2.22.3) sur le VPS. | mediasoup (bibliothèque Node, pas un serveur), Jitsi (produit complet, UI imposée), SFU maison sur Pion (des mois de travail). |
| D2 | **ForgeChat garde l'autorité.** Présence, permissions, mot de passe, places restent sur le WebSocket. Le serveur délivre un jeton LiveKit seulement après ces contrôles et éjecte du SFU à la sortie. | Service de jetons séparé (`lk-jwt-service` d'Element Call) : inutile, le serveur Axum signe lui-même. |
| D3 | Un seul port UDP multiplexé (65100) dans la plage déjà ouverte chez IONOS ; coturn borné à 65000 ; repli ICE/TCP 7881 et TURN/TLS 5349 existant. | Plage 50000-60000 : conflit avec coturn et ouverture IONOS à refaire. |
| D4 | Appels privés migrés sur le même SFU (salle `dm-<a>-<b>`). | Garder le pair-à-pair en 1:1 : même panne en réseau local. |
| D5 | Linux : ouverture automatique du salon dans le navigateur du système, avec message explicite. | Média natif via le SDK Rust de LiveKit : voir § 6. |
| D6 | Fenêtres détachées par `window.open` sur la même origine : elles partagent les flux de la fenêtre principale, sans nouvelle connexion. Sous Tauri, `on_new_window` n'autorise que `about:blank`. | Document Picture-in-Picture : une seule fenêtre par onglet. Une connexion SFU par fenêtre : double débit. |

## 4. Livré

### Transport

- `server/src/livekit.rs` : jeton HS256 (`canPublishSources` dérivé de SPEAK_VOICE et STREAM, spectateur sans publication), `RemoveParticipant` à la sortie du vocal et au raccrochage d'un appel privé. Trois tests unitaires.
- `client/src/store/voiceSfu.ts` remplace `voiceMesh.ts` derrière la même API de store : l'interface n'a pas eu à changer.
- Reconnexion du WebSocket : le média n'est plus coupé, seule la présence est rejouée (le SFU survit à un redéploiement du serveur ForgeChat).
- Télémétrie : connexion, échec de connexion, reconnexion et déconnexion avec leur raison, plus seulement les appels réussis.
- Qualité mesurée par le SFU (Excellente, Bonne, Faible, Perdue, Reconnexion). Le SFU dégrade de lui-même : simulcast caméra, dynacast, contrôle de congestion.
- Partage d'écran sans simulcast, avec préférence netteté ou fluidité ; son du partage en stéréo haute qualité sans DTX.
- Chuchotement par permissions d'abonnement : les autres gardent la caméra et le partage, pas le micro.

### Interface

- Disposition **Auto** par défaut : galerie, qui bascule d'elle-même en « stream en grand » dès qu'un écran est partagé.
- Galerie calculée : plus grande taille 16:9 telle que toutes les tuiles tiennent dans l'espace visible. Plus de chevauchement.
- Miniatures de taille réglable **S / M / L** (136, 192, 264 px), mémorisée. En S, huit miniatures tiennent sur une largeur de 1280 px.
- **Fenêtres détachées** : chaque caméra et chaque stream peut s'ouvrir dans sa propre fenêtre, autant qu'on veut. La fenêtre suit les changements de piste et se ferme quand la vidéo s'arrête. Double-clic pour le plein écran.
- On apparaît sous le salon dans sa propre barre latérale.
- Volume par personne jusqu'à 200 %.

### Infrastructure

- Service `livekit` dans `docker-compose.yml`, `livekit.yaml` sans secret (clés par `LIVEKIT_KEYS`, IP par `NODE_IP`).
- nginx : `location ^~ /livekit/` vers `127.0.0.1:7880`.
- `net.core.rmem_max` et `wmem_max` à 5 Mo.

## 5. Preuves

| Harnais | Résultat |
|---|---|
| `diag-2pc.js` (deux comptes, Chromium ou Brave) | connectés, voix crête 1,0 dans les deux sens, son du partage crête 1,0, écran 1920×1080 |
| `diag-xnet.js` (ce PC et un Chromium sur le VPS) | connectés, voix et partage reçus |
| `diag-2pc.js` avec `FC_POPOUT=1` | deux fenêtres détachées lisent en même temps, celle de l'écran se ferme à la fin du partage, miniatures S à 136 px |
| `playwright-test-dmcall.js` | 16/16 : son dans les deux sens en vocal et en vidéo, images décodées, raccrochage propagé |

## 6. Reste à faire

| Priorité | Sujet | Détail |
|---|---|---|
| Haute | **Recette sur les deux PC réels de Momo** | Seul scénario que l'automatisation ne reproduit pas. Recharger les deux pages (Ctrl+F5) avant. |
| Haute | Application de bureau 3.26.0 | Embarque le nouveau client et les fenêtres détachées ; les 3.25.0 et antérieures parlent encore pair-à-pair et n'entendent pas les clients web. |
| Moyenne | Vocal natif sous Linux | SDK Rust `livekit` dans le processus Tauri : micro et haut-parleurs via `cpal` (faisable), vidéo reçue à rendre dans la vue web (lourd). Changement d'architecture de l'app Linux : décision de Momo. |
| Moyenne | Regarder un stream sur demande | `autoSubscribe: false` pour les partages, aperçu figé et bouton « Regarder » : économise la bande passante des spectateurs passifs, comme Discord. |
| Basse | Supprimer le relais `VOICE_SIGNAL` | Gardé tant que des applications de bureau antérieures à 3.26.0 circulent. |
| Basse | Webhooks LiveKit | Nettoyer la présence d'un participant qui a quitté le SFU sans quitter ForgeChat. |
| Basse | Chiffrement de bout en bout | Supporté par LiveKit mais marqué expérimental ; incompatible avec l'enregistrement côté serveur. |

## 7. Scénarios de recette

1. Deux PC du même réseau, salon vocal : chacun entend l'autre.
2. Même chose en salon vidéo, un seul des deux avec webcam.
3. Partage d'écran avec son : l'autre voit l'écran en grand et entend le son du jeu, avec son propre volume.
4. Huit participants : miniatures en taille S sur une ligne sous le stream.
5. Détacher le stream et une caméra : deux fenêtres, déplaçables sur un autre écran, qui suivent l'appel.
6. Redéployer le serveur pendant l'appel : le son ne coupe pas.
7. Appel privé entre les deux PC : son et vidéo.
8. Application Linux : cliquer sur un salon vocal ouvre la page dans le navigateur, avec le message.
9. Volume d'une personne à 180 % : plus fort, sans erreur.
