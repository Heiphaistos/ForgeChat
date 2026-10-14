# Clés d'accès (passkeys, WebAuthn)

Module natif : `react-native-passkeys` **0.4.2** (version exacte ; la 1.0.0 listée sur npm est un
paquet vide « todo.. »). Pas de config plugin : autolinking Expo. Android : Credential Manager
(API 28+), iOS : AuthenticationServices (iOS 15+). Code : `src/lib/passkey.ts`, `src/api/passkeys.ts`,
écran `settings/passkeys.tsx`, second facteur dans `(auth)/login.tsx`.

Contrat serveur (`server/src/handlers/passkeys.rs`) : ajouter et retirer une clé exigent un code 2FA
(`code` dans le corps JSON) ; la connexion passe par `passkey` dans `/auth/login` avec les options
renvoyées par la réponse `totp_required`.

## À publier côté serveur

RP ID = hôte de `FRONTEND_URL` (ex. `forgechat.heiphaistos.org`) ; l'app doit être liée à ce domaine.

1. **Android** : `https://<hôte>/.well-known/assetlinks.json` (`client/public/.well-known/`, servi par
   `nginx.conf`) doit contenir `delegate_permission/common.get_login_creds` (en plus de
   `handle_all_urls`) avec l'empreinte SHA-256 de la clé de release. Android garde ce fichier 24 h :
   réinstaller l'app après un changement.
2. **Android, origine signée** : Credential Manager signe `android:apk-key-hash:<empreinte>` comme origine
   (pas `https://`). Le serveur la refuse tant qu'elle n'est pas listée dans `PASSKEY_APP_ORIGINS`
   (`.env`, séparées par des virgules). Pour la clé de release actuelle :
   `PASSKEY_APP_ORIGINS=android:apk-key-hash:PFujs0EnVPdVrQ-F2b36kvsQ9EztxoCkT0FZ2bUe4qo`
   (= SHA-256 du certificat en base64url sans `=`). Autre clé (APK DEV, Play App Signing) : convertir
   son empreinte de la même façon et l'ajouter.
3. **iOS** (pas de version iOS pour l'instant) : `https://<hôte>/.well-known/apple-app-site-association`
   avec `webcredentials.apps = ["<TEAMID>.org.heiphaistos.forgechat"]` ; remplacer `TEAMID` dans le
   fichier du dépôt. `app.config.ts` ajoute déjà `webcredentials:<hôte>` aux domaines associés.

APK DEV (`org.heiphaistos.forgechat.dev`) : autre paquet et autre clé, donc absent d'`assetlinks.json` :
les clés d'accès n'y marchent qu'après avoir ajouté ce paquet et son empreinte (assetlinks +
`PASSKEY_APP_ORIGINS`). L'API à contacter pour ces appels est celle de `FORGECHAT_API_URL`, qui doit
être le même hôte que `FRONTEND_URL`.

## À valider sur appareil (non vérifiable sans téléphone)

- Ajout d'une clé (code 2FA → feuille système → clé listée) puis connexion par clé sur Android avec
  l'APK **release** signé (R8 actif : les classes `Record` du module sont conservées par
  expo-modules-core, à confirmer).
- Refus serveur « origine refusée » = `PASSKEY_APP_ORIGINS` absent ou faux.
- « no matching credentials » / échec silencieux = `get_login_creds` absent d'`assetlinks.json` ou cache DAL.
- Annulation de la feuille : aucun message, aucun enregistrement.
- Dépendance Android transitive : `androidx.credentials:credentials(-play-services-auth):1.3.0-alpha01`.
