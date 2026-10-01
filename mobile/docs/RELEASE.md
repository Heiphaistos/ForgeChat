# Publication de l'app mobile

> Procédure complète de release à venir. Cette page rassemble déjà les points à ne pas oublier.

## Google Play : déclarations obligatoires

### Service au premier plan « media projection » (partage d'écran)

Le partage d'écran (appel vidéo 1:1 et salons vocaux) utilise MediaProjection. Depuis Android 14,
la capture exige un service au premier plan de type `mediaProjection` :

- permissions `FOREGROUND_SERVICE` et `FOREGROUND_SERVICE_MEDIA_PROJECTION` (ajoutées par
  `plugins/withScreenShare.js`) ;
- service `com.oney.WebRTCModule.MediaProjectionService` (fourni par react-native-webrtc).

Google Play demande une **déclaration des services au premier plan** dans la Play Console
(Contenu de l'application → Services au premier plan) pour ce type :

- usage : « partage d'écran en direct avec les autres participants d'un appel ou d'un salon
  vocal, lancé uniquement à la demande de l'utilisateur » ;
- **vidéo de démonstration** demandée : montrer l'avertissement avant le partage, le dialogue
  système, la notification pendant la capture et l'arrêt ;
- la capture s'arrête quand l'utilisateur appuie sur « Arrêter » (bandeau de l'app ou
  notification système), raccroche ou quitte le salon.

Sans cette déclaration, la mise en ligne sur le Play Store est refusée. Les APK distribués hors
Play Store (bêta) ne sont pas concernés.
