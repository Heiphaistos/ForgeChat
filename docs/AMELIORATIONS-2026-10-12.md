# ForgeChat — 50 améliorations proposées (2026-10-12)

Suite de l'audit du 2026-10-12 (`docs/AUDIT-securite-2026-10-12.md`). Les points déjà en place ne
sont pas repris : chiffrement de bout en bout (clés de compte, d'époque, de serveur signée par le
propriétaire), Argon2id, cookies préfixés, CSP + Trusted Types, verrou biométrique et blocage des
captures sur mobile, garde de déploiement signé.

Priorité : 🔴 haute · 🟠 moyenne · 🟢 confort.

## Contrôle « rien de secret dans le front » (fait le 2026-10-12)

- `client/dist` (ce que télécharge le navigateur) : aucune carte de source (`.map`), aucune variable
  d'environnement, aucun jeton, mot de passe ni clé. Seules adresses présentes : le contact public des
  pages légales et une adresse de licence d'une bibliothèque.
- Mobile : `extra` d'`app.config.ts` ne contient que l'URL de l'API, l'environnement, l'hôte LiveKit
  et l'identifiant de projet EAS (tous publics). Seule variable `EXPO_PUBLIC_` : `APP_ENV`.
  `EXPO_ACCESS_TOKEN`, `TOTP_ENC_KEY`, `EMAIL_ENC_KEY`, le secret TURN restent côté serveur.
- Bureau : aucun secret dans `tauri.conf.json` ni dans `src-tauri/src` ; le petit serveur vidéo local
  écoute sur 127.0.0.1 avec un secret aléatoire par lancement.
- API : les identifiants TURN sont éphémères (HMAC + expiration), jamais le secret partagé.
- Historique git des 3 dépôts (52 000 objets parcourus) : aucune clé privée, aucun jeton
  GitHub/AWS/Google/Slack/Stripe/Hugging Face. Seule clé versionnée : `deploy/release-signing-public.pem`
  (publique, c'est voulu).
- ⚠️ Point d'hygiène : le commit 70945cc (audit) a versionné par erreur `desktop/src-tauri/target/`
  (≈ 60 000 fichiers de build, aucun secret dedans). À retirer : voir n° 1.

## Sécurité (25)

1. 🔴 Retirer `desktop/src-tauri/target/` du dépôt et l'ajouter au `.gitignore` ; fusionner la
   branche d'audit en *squash* pour que ces fichiers n'entrent pas dans l'historique de `main`.
2. 🔴 Scan de secrets automatique en CI (gitleaks ou trufflehog) sur chaque push et PR, et
   « Push protection » de GitHub activée sur les 3 dépôts.
3. 🔴 Passkeys / WebAuthn comme second facteur (et à terme sans mot de passe), en plus du TOTP :
   résistant à l'hameçonnage, contrairement aux codes à 6 chiffres.
4. 🔴 Codes de secours du TOTP affichés une seule fois, stockés hachés, et alerte par e-mail à
   chaque connexion depuis un nouvel appareil.
5. 🔴 Liste des appareils/sessions avec révocation à distance (côté web, bureau et mobile), avec
   dernier IP approximatif et date.
6. 🔴 Vérification des mots de passe compromis (Have I Been Pwned, k-anonymat sur les 5 premiers
   caractères du SHA-1) à l'inscription et au changement.
7. 🟠 Rapports CSP et Trusted Types (`report-to`) vers une route du serveur limitée en débit, pour
   voir toute tentative d'injection en production.
8. 🟠 Activer Trusted Types dans l'appli de bureau (CSP de Tauri) après un essai sur Windows/macOS.
9. 🟠 Protection « Double Ratchet » pour les MP (confidentialité persistante par message) ; les
   époques actuelles protègent par période, pas par message.
10. 🟠 Transparence des clés : journal public append-only des clés de compte, consultable par les
    clients pour détecter une substitution par le serveur.
11. 🟠 Code de sécurité en QR code à scanner en personne (vérification de contact plus simple que
    la comparaison des chiffres).
12. 🟠 Chiffrer les métadonnées : noms de salons et de serveurs, sujets, réactions (aujourd'hui en
    clair côté serveur).
13. 🟠 « Sealed sender » pour les MP : le serveur ne garde pas qui écrit à qui au-delà du nécessaire.
14. 🟠 Durée de rétention configurable des journaux serveur et purge automatique des IP au-delà de
    30 jours (RGPD).
15. 🟠 Sauvegardes Postgres chiffrées (age/GPG), hors du VPS, avec un test de restauration mensuel.
16. 🟠 Supervision de sécurité : alertes sur pics d'échecs de connexion, de 401/403, de rapports CSP.
17. 🟠 fail2ban ou équivalent sur nginx et SSH du VPS ; SSH par clé seulement, sans root.
18. 🟠 Chiffrement des fichiers envoyés au repos sur le serveur, et suppression réelle (pas
    seulement logique) quand le message est effacé.
19. 🟠 Analyse antivirus (ClamAV) des pièces jointes non chiffrées, en tâche de fond.
20. 🟠 Épinglage du certificat (ou de la clé publique) du serveur dans les applis mobiles et bureau.
21. 🟢 Dependabot / Renovate avec fusion automatique des correctifs de sécurité mineurs, et
    `cargo audit` + `npm audit` bloquants en CI.
22. 🟢 Tests de fuzzing (cargo-fuzz) sur le décodage des messages WebSocket et des fichiers envoyés.
23. 🟢 Programme de divulgation responsable : `/.well-known/security.txt` et page dédiée.
24. 🟢 Builds reproductibles de l'appli de bureau et publication des empreintes SHA-256 signées.
25. 🟢 Mode « panique » : verrouillage immédiat de toutes les sessions et rotation des clés depuis
    un lien reçu par e-mail.

## Produit et expérience (25)

26. 🔴 Multi-appareils propre : lier un nouvel appareil par QR code en transférant les clés E2E
    (sans repasser par le mot de passe).
27. 🔴 Recherche dans les messages chiffrés, côté client (index local chiffré).
28. 🔴 Notifications push riches mais chiffrées (contenu déchiffré sur l'appareil, pas sur le serveur).
29. 🔴 Mode hors ligne complet : file d'envoi, brouillons et lecture des derniers messages sans réseau.
30. 🟠 Sauvegarde/restauration de l'historique chiffré (fichier protégé par phrase secrète).
31. 🟠 Messages vocaux transcrits localement (Whisper sur l'appareil, rien n'est envoyé).
32. 🟠 Réponses dans les fils plus visibles : compteur et aperçu sous le message parent.
33. 🟠 Modification de message avec historique visible des versions.
34. 🟠 Partage de position en temps réel (durée limitée, chiffrée).
35. 🟠 Sondages chiffrés de bout en bout dans les MP et groupes.
36. 🟠 Statuts personnalisés avec expiration (« En réunion jusqu'à 15 h »).
37. 🟠 Accès invité : lien temporaire vers un salon en lecture seule, sans création de compte, révocable.
38. 🟠 Tableau de bord d'administration : santé du serveur, file d'envoi d'e-mails, erreurs récentes.
39. 🟠 Modération assistée : file de signalements unifiée avec actions rapides et historique.
40. 🟠 Onboarding guidé (3 écrans) qui explique le chiffrement et la vérification des contacts.
41. 🟠 Accessibilité : audit lecteur d'écran (ARIA), contraste AA, navigation clavier dans les appels.
42. 🟢 Thèmes personnalisés exportables/importables.
43. 🟢 Widgets mobiles (messages non lus, salon vocal en cours).
44. 🟢 Raccourcis de réponse rapide depuis la notification (Android et iOS).
45. 🟢 Traduction des messages à la demande, faite sur l'appareil.
46. 🟢 Galerie des médias et fichiers par conversation, avec filtres.
47. 🟢 Rappels sur un message (« me le rappeler dans 1 h ») synchronisés entre appareils.
48. 🟢 Mode « Ne pas déranger » programmé (horaires, week-end) avec exceptions pour les favoris.
49. 🟢 Statistiques de serveur lisibles (activité par jour, salons les plus actifs) sans données
    personnelles.
50. 🟢 Page d'état publique (disponibilité de l'API, de la voix, des envois d'e-mails).
