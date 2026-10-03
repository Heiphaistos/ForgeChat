# ForgeChat bêta (Android) — guide des testeurs

Merci de tester ForgeChat ! Cette bêta est l'application **ForgeChat** (icône violette, sans mention
« DEV »), connectée au serveur public annoncé par l'équipe.

## ⚠️ À savoir avant d'installer

- **Les messages ne sont pas chiffrés de bout en bout.** Ils sont chiffrés pendant le transport
  (HTTPS), mais le serveur peut les lire. N'envoie rien que tu ne confierais pas à l'administrateur
  du serveur. Le chiffrement de bout en bout est en cours de conception.
- C'est une **bêta** : bugs possibles, données de test susceptibles d'être effacées.
- **Android uniquement** pour l'instant : pas de version iPhone (aucune n'a été construite ni testée).

## Installer

1. Télécharge l'APK depuis la page **Releases** GitHub indiquée par l'équipe (seule source officielle ;
   pas de Play Store pour l'instant). N'installe **jamais** un APK ForgeChat venant d'ailleurs.
   Guide pas à pas : `docs/INSTALLER.md`.
2. **Vérifie le fichier** avant de l'ouvrir (voir plus bas).
3. Ouvre le fichier APK. Android demande d'**autoriser l'installation d'applications inconnues** pour
   l'application qui l'ouvre (navigateur ou gestionnaire de fichiers) : autorise-la, installe, puis
   **retire cette autorisation** (Paramètres → Applications → accès spéciaux → Installer des applications
   inconnues).
4. Ouvre ForgeChat et connecte-toi (ou crée un compte).

Les mises à jour s'installent par-dessus, sans perdre tes données, tant qu'elles viennent de la même
source officielle. Si Android refuse la mise à jour (« conflit de signature »), **arrête-toi** et
préviens l'équipe : l'APK ne vient pas de nous.

## Vérifier l'APK

La page de release publie deux empreintes :

- **SHA-256 du fichier** :
  - Linux / macOS : `sha256sum ForgeChat-x.y.z-beta.apk` (ou `shasum -a 256`) ;
  - Windows (PowerShell) : `Get-FileHash ForgeChat-x.y.z-beta.apk -Algorithm SHA256`.
  Le fichier `SHA256SUMS.txt` de la release donne la valeur attendue.
  Le résultat doit être **identique** à celui publié.
- **Empreinte du certificat de signature** : toujours la même d'une version à l'autre. Avec les outils
  Android : `apksigner verify --print-certs ForgeChat-x.y.z-beta.apk`. Elle doit valoir (SHA-256) :
  `5E:A3:DB:62:2C:07:AA:69:54:D8:D9:2F:80:32:6E:24:60:A9:80:9C:94:80:5D:77:06:C0:0D:EC:E3:69:3C:BD`.
  Si elle change sans annonce de l'équipe, n'installe pas.

## Signaler un bug

Indique, si possible :

- ce que tu faisais, ce qui s'est passé, ce que tu attendais ;
- le modèle du téléphone et la version d'Android ;
- la version de ForgeChat (onglet **Vous**, en bas de l'écran) ;
- une capture d'écran **sans informations personnelles** (ForgeChat bloque les captures quand
  « Masquer dans le sélecteur d'apps » est activé : désactive-le le temps de la capture si besoin).

Ne mets jamais ton mot de passe, ni un code de vérification, dans un rapport de bug.

## Ce que la bêta ne fait pas encore

- Chiffrement de bout en bout des messages privés et des groupes.
- Partage d'écran : uniquement en appel **vidéo** et dans les salons vocaux, sans le son de l'écran ;
  les écrans de ForgeChat apparaissent noirs chez les autres quand la protection des captures est
  active.
- Les mentions dans les groupes n'apparaissent pas dans l'onglet Mentions.
- Double authentification (2FA) : se configure depuis la version web.
