# Feuille de route : tout ce que fait Discord, gratuit chez ForgeChat

Inventaire du 2026-10-07 (code lu, pas supposé). Web/bureau ≈ 80 % de Discord ; mobile très en retrait.
Les fonctions payantes de Discord (Nitro, boosts) sont gratuites ici.

## Limites « façon Nitro » à lever
- Upload 50 Mo (Discord Nitro : 500 Mo)
- Emojis, stickers et soundboard limités au serveur courant
- Partage d'écran plafonné à 1440p / 8 Mb/s ; caméra mobile en 480p
- 50 sons et 60 stickers par serveur ; emoji ≤ 256/512 Ko ; bannière serveur ≤ 2 Mo
- Boosts gratuits mais sans effet (bouton « bientôt disponible » cassé)

## Manques, par valeur
| # | Manque | Effort |
|---|---|---|
| 1 | Mobile : forum, fils, sondages (lecture et vote) | L |
| 2 | Emojis et stickers de tous ses serveurs | S |
| 3 | Mobile : caméra en salon vocal, sourdine, caméra 720p/1080p | S |
| 4 | Mobile : transférer, signets, rappels, historique d'édition | S |
| 5 | Upload relevé (ou par morceaux) | S/M |
| 6 | Stream 4K / 60 i/s | S |
| 7 | Vraie traduction de l'interface (le réglage de langue est sans effet) | L |
| 8 | Flou / remplacement d'arrière-plan vidéo | M |
| 9 | Mobile : réglages et modération serveur | L |
| 10 | Mobile : scène, soundboard, push-to-talk, suppression de bruit | M |
| 11 | Soundboard partout, quotas relevés | S |
| 12 | Boosts : bouton réparé et paliers qui débloquent quelque chose | S |
| 13 | Adresse personnalisée d'invitation (vanity URL) résolue | S |
| 14 | Profil par serveur (avatar, bannière, bio) | M |
| 15 | Icônes de rôles et couleurs dégradées | M |
| 16 | Dossiers de serveurs synchronisés (et sur mobile) | S |
| 17 | Mobile : activer la 2FA, recherche avancée, Ctrl+K, thèmes | M |
| 18 | Activité « joue à » automatique, Rich Presence | M/L |
| 19 | Suivi des salons d'annonces (crosspost) | M |
| 20 | Onboarding de serveur (questions → rôles) | M |
| 21 | Super réactions | S/M |
| 22 | Salon médias | M |
| 23 | Effets, décorations, thème de profil | M |
| 24 | Vérification d'âge des salons NSFW | S |
| 25 | Clips (30 dernières secondes) | L |
| 26 | Activités / jeux en vocal | L |
| 27 | Splash d'invitation, icônes d'app | S |

## État au 2026-10-07 matin (serveur 3.271.0, web 3.615.0, mobile 1.2.0 publié, 1.3.0 en préparation)
Fait et vérifié en prod (tests dans forgechat-loop/tests) :
- Limites levées : envois 500 Mo, emojis/stickers/sons de tous ses serveurs, partage d'écran 4K / 20 Mb/s, caméra mobile 720p, boosts réparés.
- #1, #3, #4, #9, #10, #17 mobile : forums, fils, sondages, transfert, signets, rappels, historique, administration serveur complète, scène, soundboard, 2FA, recherche, 28 thèmes (partagés avec le web).
- #2, #5, #6, #11, #12, #13 : voir ci-dessus.
- #8 flou d'arrière-plan (web/bureau, calcul local MediaPipe).
- #14 profil par serveur, #15 icônes de rôles et dégradés, #16 dossiers de serveurs synchronisés (et affichés sur mobile), #19 annonces suivies, #20 onboarding, #21 super réactions, #22 salons médias, #24 confirmation d'âge NSFW (web).
- En plus : salon AFK appliqué, signalement des MP (file admin du site), renommer un fil, Scène sécurisée côté serveur.

Reste : #7 traduction de l'interface, #18 activité « joue à » automatique, #23 effets/décorations de profil, #25 clips, #26 activités en vocal, #27 splash d'invitation ; MP chiffrés sur mobile (décision : clés par appareil côté serveur) ; confirmation d'âge NSFW sur mobile ; dégradé de rôle sur mobile (dépendance native).
