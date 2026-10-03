# Installer ForgeChat sur Android

ForgeChat n'est pas sur le Play Store pour l'instant : l'application se télécharge **uniquement**
depuis la page **Releases** de ce dépôt GitHub. N'installe jamais un fichier ForgeChat venant
d'ailleurs (site, messagerie, clé USB d'un inconnu…).

> ⚠️ C'est une **bêta**. Les messages sont chiffrés pendant le transport (HTTPS), mais **pas de bout en
> bout** : l'administrateur du serveur peut les lire. N'envoie rien de sensible.

---

## 1. Télécharger

1. Sur ton téléphone, ouvre la page **Releases** du dépôt et prends la plus récente (en haut, marquée
   **Latest**).
2. Dans **Assets**, touche **`ForgeChat-x.y.z-beta.apk`** (x.y.z = numéro de version). Le navigateur
   peut avertir que « ce type de fichier peut être dangereux » : touche **Télécharger quand même**.

## 2. Vérifier (recommandé)

La page de la release indique l'**empreinte SHA-256** du fichier. Elle prouve que le fichier n'a pas
été modifié.

- **Sur un ordinateur** : télécharge aussi l'APK, puis
  - Windows (PowerShell) : `Get-FileHash ForgeChat-x.y.z-beta.apk -Algorithm SHA256`
  - macOS : `shasum -a 256 ForgeChat-x.y.z-beta.apk`
  - Linux : `sha256sum ForgeChat-x.y.z-beta.apk`

  Le résultat doit être **exactement** celui de la release (et du fichier `SHA256SUMS.txt`).
- **Sur le téléphone** : une app de calcul d'empreinte (« hash checker ») fait la même chose.

L'application est toujours signée avec le **même certificat**, dont l'empreinte SHA-256 est :

```
5E:A3:DB:62:2C:07:AA:69:54:D8:D9:2F:80:32:6E:24:60:A9:80:9C:94:80:5D:77:06:C0:0D:EC:E3:69:3C:BD
```

Android vérifie lui-même ce certificat lors de chaque **mise à jour** : une fausse version serait
refusée.

## 3. Installer

1. Ouvre le fichier téléchargé (notification de téléchargement, ou app **Fichiers** → *Téléchargements*).
2. Android affiche « Pour votre sécurité, votre téléphone n'est pas autorisé à installer des applications
   inconnues provenant de cette source » : touche **Paramètres**, active **Autoriser cette source**,
   puis reviens en arrière.
3. Touche **Installer**. Si **Play Protect** affiche « Application inconnue » ou propose une analyse :
   c'est normal pour une app hors Play Store ; choisis **Plus de détails** → **Installer quand même**
   (ou lance l'analyse : elle doit être sans problème).
4. Une fois installée, retire l'autorisation : **Paramètres** → **Applications** → **Accès spéciaux**
   (ou *Accès spécifiques des applications*) → **Installer des applications inconnues** → ton navigateur
   → désactive.
5. Ouvre **ForgeChat**, crée un compte ou connecte-toi.

## 4. Mettre à jour

- Quand une nouvelle version sort, ForgeChat te le **propose au démarrage** (au plus une fois par jour)
  et ouvre la page de la release : télécharge l'APK et installe-le comme ci-dessus. Android affiche
  **Mettre à jour** : tes conversations et ton compte sont conservés.
- Cette vérification envoie seulement une requête anonyme à GitHub pour lire le numéro de la dernière
  version. Tu peux la couper : **Vous** → **Sécurité et confidentialité** → **Mises à jour**.
- **Ne désinstalle pas** l'app avant de mettre à jour (tu perdrais les données locales).
- Si Android refuse la mise à jour avec un **conflit de signature** ou « application non installée » :
  **arrête-toi**, le fichier ne vient pas de nous. Signale-le.

## 5. Un problème ?

Ouvre un ticket (**Issues**) sur ce dépôt ou préviens la personne qui t'a invité, avec : le modèle du
téléphone, la version d'Android, la version de ForgeChat (**Vous**, en bas de l'écran) et ce qui s'est
passé. N'y mets jamais ton mot de passe ni de capture contenant des messages privés.
