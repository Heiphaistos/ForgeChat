# Sécurité

> Android uniquement pour l'instant : les mentions d'iOS ci-dessous décrivent ce que le code prévoit
> (compatible en théorie grâce à Expo), mais aucune version iOS n'a été construite ni testée.

## Mesures côté app mobile

### Secrets et session
| Mesure | Où |
|---|---|
| Refresh token dans le Keychain (iOS) / Keystore (Android), `WHEN_UNLOCKED_THIS_DEVICE_ONLY` : illisible appareil verrouillé, jamais restauré sur un autre appareil | `lib/tokens.ts` |
| Access token uniquement en mémoire, jamais persisté | `lib/tokens.ts` |
| Rotation du refresh token à chaque usage, refresh « single-flight » (deux refresh parallèles invalideraient la session) | `lib/http.ts` |
| Nouveau refresh token persisté **avant** d'utiliser le nouvel access token | `lib/http.ts` |
| Cookies désactivés (`credentials: 'omit'`) : un cookie résiduel ne peut pas prendre le pas sur le Bearer | `lib/http.ts` |
| Déconnexion : révocation serveur puis effacement local complet (tokens, cache, push, appels) | `stores/auth.ts` |
| Session révoquée à distance / mot de passe changé → effacement local automatique | `stores/auth.ts` |
| Android : `allowBackup=false`, règles d'exclusion de sauvegarde pour SecureStore | `app.config.ts` |

### Transport
| Mesure | Où |
|---|---|
| HTTPS obligatoire hors développement : le build échoue si l'URL n'est pas `https://`, et l'app refuse au runtime | `app.config.ts`, `config/env.ts` |
| Trafic en clair interdit au niveau OS Android en préproduction/production ; ATS actif sans exception sur iOS | `app.config.ts` |
| WebSocket authentifié par ticket éphémère à usage unique (le JWT n'apparaît jamais dans une URL) | `lib/realtime.ts` |
| Timeouts sur toutes les requêtes ; taille des messages WebSocket bornée (entrée et sortie) | `lib/http.ts`, `lib/realtime.ts` |
| Services externes contactés : uniquement GitHub (vérification des mises à jour, désactivable) et les CDN d'images GIF (`media.tenor.com`, `static*.klipy.com`) pour afficher un GIF (URL https strictement validées). La recherche de GIF passe par le serveur ForgeChat : aucune clé d'API dans l'APK, KLIPY ne voit pas les recherches de l'utilisateur | `features/updates`, `features/composer/formats.ts`, `features/composer/gifs.ts` |

### Entrées non fiables
| Mesure | Où |
|---|---|
| Rendu Markdown en composants natifs : aucun HTML, aucune WebView → pas d'injection de script | `lib/markdown.ts` |
| Parseur borné (taille, profondeur) contre les messages piégés | `lib/markdown.ts` |
| Liens : seuls `http(s)` ; refus des URL avec identifiants (`https://banque.fr@pirate.tld`) ; confirmation montrant le vrai domaine ; ouverture dans un navigateur in-app isolé | `lib/links.ts` |
| Médias : seules les URL `/uploads/…` du serveur (sans `..`) ou `https` sont chargées | `lib/links.ts` |
| Paramètres de route (liens profonds, notifications) validés (UUID, codes d'invitation) avant tout appel | `lib/params.ts`, `services/push.ts` |
| Segments de chemin d'API encodés (`path\`\``) : pas de traversée ni d'injection | `lib/http.ts` |
| Événements WebSocket : types et tailles des champs vérifiés avant d'écrire dans le cache | `services/realtimeBindings.ts` |
| Réponse de login/inscription validée par schéma (zod) | `api/auth.ts` |

### Vie privée
| Mesure | Où |
|---|---|
| Photos ré-encodées avant envoi : métadonnées EXIF (dont la position GPS) retirées | `features/chat/Composer.tsx` |
| Noms de fichiers nettoyés, extensions et tailles contrôlées avant upload (miroir des règles serveur) | `features/chat/useConversation.ts` |
| Notifications sans contenu par défaut (le contenu transiterait par Apple/Google) ; aperçu activable | `services/push.ts`, serveur |
| Notifications Android en visibilité « privée » sur l'écran verrouillé | `services/push.ts` |
| Brouillons de messages en mémoire uniquement | `features/chat/ChatView.tsx` |
| Logs : JWT, Bearer, refresh tokens, tickets et mots de passe masqués ; `console.*` interdit par le lint | `lib/logger.ts`, `eslint.config.js` |

### Protection locale
| Mesure | Où |
|---|---|
| Verrouillage biométrique / code appareil, délai configurable, activation confirmée par une authentification | `stores/lock.ts`, `settings/security.tsx` |
| Masquage dans le sélecteur d'apps (iOS) / `FLAG_SECURE` (Android, bloque aussi les captures) | `services/lifecycle.ts` |
| Décrocher un appel alors que l'app est verrouillée exige le déverrouillage | `components/Overlays.tsx` |
| Permissions minimales ; permissions inutiles explicitement retirées (stockage externe, fenêtre système, état du téléphone) | `app.config.ts` |

### Partage d'écran (Android)

| Point | Détail |
|---|---|
| Lancement | Uniquement à la demande : avertissement « Tout ce qui s'affiche sur ton écran sera visible, y compris les notifications », puis dialogue système Android (écran entier, ou une seule application à partir d'Android 14 si le système le propose) |
| Pendant | Bandeau rouge « Partage d'écran en cours » avec Arrêter, et notification système du service au premier plan `mediaProjection` |
| Arrêt | Bouton Arrêter, fin d'appel, sortie du salon vocal, ou arrêt par Android : la capture est libérée (plus de projection ni de notification, vérifié sur émulateur) |
| ForgeChat lui-même | Quand « Masquer dans le sélecteur d'apps » est actif (`FLAG_SECURE`), les écrans de ForgeChat apparaissent **en noir** chez le destinataire (seule la barre d'état reste visible) ; les autres applications et l'écran d'accueil sont transmis normalement. C'est voulu : les conversations ne fuient pas par le partage. |
| Son | Pas de capture du son de l'écran en v1 (évolution possible : `AudioPlaybackCapture`, Android 10+, mixé au micro comme le fait le client web) |
| Appel 1:1 | Uniquement en appel vidéo : l'écran remplace la caméra envoyée (le client web n'a pas de partage d'écran en appel 1:1 et n'affiche la vidéo distante qu'en appel vidéo) |

## Mesures côté serveur (patch fourni)

- Enregistrement des appareils push : format de token vérifié, rate limit (30/h), 10 appareils max par
  compte, réattribution d'un token à un nouveau compte (changement d'utilisateur sur un téléphone).
- Désinscription limitée aux tokens de l'appelant.
- Push supprimés à la déconnexion globale et au changement de mot de passe ; tokens invalides purgés.
- Push de mention : uniquement aux membres du serveur, jamais si le destinataire a bloqué l'auteur.
- Anti-flood : 1 push par conversation et par destinataire toutes les 3 s ; respect du « Ne pas déranger »
  et des DM en sourdine.
- Déconnexion ciblée (`scope: "current"`) : se déconnecter du téléphone ne ferme plus les autres sessions.

## Constats sur le backend

Les constats concernant le backend sont suivis directement avec le mainteneur du serveur.

Corrigé dans le patch : le snapshot `PRESENCE_INIT` était envoyé avant l'abonnement du client au canal
de diffusion et donc perdu sur une première connexion.
