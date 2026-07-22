# CHECKPOINT — LOOP REPRISE (post refactor MessageList)

## Statut : ACTIVE (code) / DÉPLOIEMENT TOUJOURS CASSÉ depuis it.9 — Momo doit investiguer

**Itération 15 (2026-07-22 15:37, commit ef49ea2, server 3.169.0)** : nouvelle piste
(threads.rs, jamais audité) -> trouvé corruption d'encodage réelle (mojibake double
UTF-8/Latin-1) dans threads.rs ET forum.rs, touchant des messages d'erreur RENVOYÉS
AU CLIENT ("caractÃ¨res" au lieu de "caractères", etc) -- bug visible utilisateur.
grep global confirme : seuls ces 2 fichiers touchés dans tout le repo. Fixé (piège :
certaines occurrences avaient un espace insécable invisible en plus du mojibake,
résolu via round-trip Python latin1/utf8 plutôt que remplacement texte manuel).
Texte uniquement, aucune logique changée. cargo check clean.

## Statut précédent : ACTIVE (code) / DÉPLOIEMENT TOUJOURS CASSÉ depuis it.9 — Momo doit investiguer

**Itération 14 (2026-07-22 15:13, commit f572560, client 3.514.0)** : pivot demandé
(veine let-_-swallow épuisée). Audit IDOR/ownership complet de group_dms.rs (16
handlers), whiteboard WS handler, VOICE_STATE handler -> tous propres, rien trouvé.
Pivot a11y -> trouvé : sélecteurs de tuile spotlight (vues Spotlight+Sidebar,
VoiceVideoPage.tsx) en `<div onClick>` nu sans clavier ni aria-label. Fix role="button"
+ tabIndex + Enter/Space + aria-label nominatif. tsc/eslint/build clean.

## Statut précédent : ACTIVE (code) / DÉPLOIEMENT TOUJOURS CASSÉ depuis it.9 — Momo doit investiguer

**Itération 13 (2026-07-22 14:50, commit ed4a725, server 3.168.0)** : dernière trouvaille
de la veine `let _ =`/`.ok()` sur audit_log — `channels.rs:612` (PURGE_MESSAGES,
suppression en masse) insérait dans audit_log en inline en contournant le helper
log_event() corrigé it.11, même `.ok()` silencieux. Fixé (tracing::error!). Audité et
laissé tel quel : call_history.rs (best-effort, log d'affichage, la vraie
signalisation d'appel n'en dépend pas) et scheduled.rs last_message_id (déjà protégé
par transaction pour la partie critique). **VEINE `let _ =`/`.ok()` SERVEUR MAINTENANT
ÉPUISÉE** — tous les sites du fichier ont été revus sur 3 itérations (11, 12, 13) :
websocket.rs (presence/tx.send, benins), users.rs/friends.rs/emojis.rs/stickers.rs
(cleanup fichiers, benins), main.rs (2 tâches idempotentes laissées, 1 fixée). Prochaine
itération : NE PAS re-grep ce pattern, pivoter vers une autre piste GOAL.md (a11y,
IDOR/ownership sur endpoints récents, robustesse frontend, ou nouvelle relecture ciblée
d'un fichier pas encore audité).

## Statut précédent : ACTIVE (code) / DÉPLOIEMENT TOUJOURS CASSÉ depuis it.9 — Momo doit investiguer

**Itération 12 (2026-07-22 14:27, commit ea82420, server 3.167.0)** : suite de l'audit
`let _ =` serveur commencé it.11 (feeds.rs, main.rs). 2 vrais bugs même famille que
group_dms (it.11) : échec UPDATE silencieux -> spam de doublons en boucle. (1)
feeds.rs process_feed : UPDATE last_item_guid avalé -> item RSS re-posté en boucle
toutes les 5min si l'update échoue une fois ; propagé via `?` (fonction retourne déjà
anyhow::Result, l'appelant logue déjà). (2) main.rs tâche rappels : UPDATE sent=TRUE
avalé -> rappel rebroadcasté à CHAQUE tick (30s) indéfiniment ; pas de Result ici
(boucle tokio::spawn nue), loggé via tracing::error! à la place. Les 2 autres tâches
main.rs (unban, cleanup éphémères) vérifiées idempotentes, laissées telles quelles.
cargo check clean. Poussé (déploiement toujours bloqué côté VPS, pas re-vérifié ce
tour — pas de nouvelle info depuis it.11, pas de valeur à re-poller sans action de
Momo entre-temps).

## Statut précédent : ACTIVE (code) / DÉPLOIEMENT CONFIRMÉ CASSÉ depuis it.9 — Momo doit investiguer

**Preuve définitive (itération 11, 2026-07-22 14:05)** : commit 4deeb49 touche le
SERVEUR (server/src/handlers/*.rs) — un rebuild Docker/cargo est donc obligatoire,
aucun cache ne peut l'éviter. Poussé, CI Forgejo montre le job comme lancé, HEAD VPS
passe bien à 4deeb49 (git reset fonctionne), MAIS `forgechat-server-1` n'a PAS été
recréé (CreatedAt toujours 11:43:04 UTC, identique à avant ce push). Donc : le `git
reset --hard` de l'étape SSH tourne, mais tout ce qui suit (npm ci/build, docker
compose up --build) ne s'exécute plus RÉELLEMENT, tout en faisant remonter un exit 0
("status":"success" côté API Forgejo Actions, ~15s). Confirme et durcit le diagnostic
de l'itération 10 (qui portait sur un changement client, où on pouvait encore
suspecter un souci spécifique au build client) : le problème est dans l'étape SSH
elle-même ou l'environnement du runner, pas dans le code des commits poussés.

**Hypothèses non vérifiables sans accès plus profond (bloqué par le classifier de
permissions, ne PAS forcer)** : script SSH qui échoue silencieusement après le
`git reset` sans faire remonter d'erreur (peu probable avec `set -e` + ssh qui devrait
propager l'exit code) ; ou VPS_HOST/VPS_USER pointe ailleurs que ce que j'atteins en
SSH direct depuis mon environnement ; ou un état corrompu côté runner (cache npm,
docker) qui fait sortir `npm ci`/`docker compose` en 0 sans rien faire. Recommandation
concrète pour Momo : ouvrir l'UI Forgejo Actions (Heiphaistos/ForgeChat → Actions →
run le plus récent) et lire le log complet étape par étape — c'est la seule vue que
je n'ai pas pu obtenir (auth basic bloquée sur les routes web, classifier bloque le
SSH mutation/exploration profonde).

## Statut précédent : EN PAUSE — itérations 8+9+10 codées, DÉPLOIEMENT CASSÉ depuis it.9, à investiguer par Momo

**Anomalie déploiement découverte pendant it.10** : commits eeb7bfd (it.9) et 35d7d18
(it.10) montrent tous les deux "status":"success" via l'API Forgejo Actions
(`/actions/runs/832` et `/833`, durée ~15s chacun) MAIS `/opt/forgechat/client/dist/`
sur le VPS (version.json ET index.html) a un mtime figé à 11:23:12 UTC — le build de
l'itération 8 (commit 6273451), PAS des suivants. Le site prod sert toujours 3.512.0
au lieu de 3.513.0. Donc soit le job SSH ne fait plus réellement le `npm run build`
malgré un exit 0, soit il déploie ailleurs. Pas creusé plus loin : investigation SSH
manuelle (git reset/npm ci en direct) bloquée par le classifier de permissions
(action prod à risque, correctement bloquée). NE PAS forcer — Momo doit soit
regarder lui-même (workflow_dispatch manuel + logs Forgejo Actions UI), soit
autoriser une investigation SSH plus poussée.

**Ce qui EST confirmé sain** : itérations 8 (memo fix MessageList/MessageRow) et 9
(brace-expansion) déployées et vérifiées en prod avant que l'anomalie n'apparaisse
(version.json 3.512.0, VPS HEAD eeb7bfd, /health 200). Le code de l'itération 10
(ws.ts) est correct et testé localement (tsc/eslint/build/cargo check clean), juste
pas confirmé live.

## Statut précédent : ACTIVE — itérations 8+9 faites, en attente d'itération 10

**Itération 8 (2026-07-22 13:10, commit 6273451, client 3.512.0)** : spot-check du
refactor MessageList->MessageRow (b44fd8d) toujours NON CONFIRMÉ par Momo — pas de
retour dans cette session ni trace en mémoire globale. Ne PAS supposer cassé faute de
réponse, juste non validé. Relecture fraîche du refactor -> bug réel de mémoïsation
trouvé (voir LESSONS.md, entrée React.memo) : onReply/onOpenThread/onPinMessage/
onAddReaction/onEditMessage arrivaient de ChannelPage en fonctions inline instables,
cassant React.memo(MessageRow) pour toute la liste à chaque tick (countdown slowmode,
typing). Fixé dans MessageList.tsx (pattern ref + wrappers stables). Déployé + vérifié
prod (version.json 3.512.0, VPS HEAD).

**Itération 9 (2026-07-22 13:25, commit eeb7bfd)** : push it.8 a révélé une alerte
GitHub Dependabot HIGH ouverte (#9, brace-expansion <1.1.16, DoS exponentiel, CWE-400/407)
— transitive via eslint->minimatch@3.1.5, scope development seul (pas dans le bundle
runtime, mais checklist CLAUDE.md exige 0 vuln). `npm audit fix` -> brace-expansion
1.1.16, 0 vulnérabilité. tsc/eslint/build clean. Déployé + vérifié prod (version.json
3.512.0 inchangé côté client fonctionnel, HEAD VPS = eeb7bfd, /health 200).

## Statut précédent : ACTIVE — Momo présent a demandé un refactor perf hors-loop (traité), puis
"enregistre en mémoire, clear, reprends la loop" (2026-07-22, après-midi)

Depuis l'arrêt à 7/8 : Momo a choisi de traiter le finding "refactor perf MessageList"
(proposé via AskUserQuestion) plutôt que le mutex WebRTC. Fait sur branche
`refactor/messagelist-memo`, vérifié statiquement (tsc/eslint/build clean), mergé,
poussé, déployé (commit b44fd8d, VPS HEAD confirmé). Demande de spot-check humain
envoyée à Momo (réactions/édition/réponse/suppression) — PAS ENCORE CONFIRMÉE en
retour au moment de cette reprise. Détail complet dans project_forgechat.md (mémoire
globale) section "CYCLE 11".

Prochaine itération (8) : d'abord vérifier si Momo a confirmé/infirmé le refactor
MessageList (si aucun retour, ne pas supposer que c'est cassé — c'est juste non
confirmé). Puis chercher une nouvelle piste sûre : le refactor vient de changer 3
fichiers chat/ substantiels, ça vaut une relecture fraîche pour un bug qu'une 1ère
passe aurait raté. Sinon revenir aux pistes GOAL.md non encore épuisées.

## Historique complet (7 itérations nocturnes, avant ce message)

## Statut : ARRÊTÉE — rapport prêt pour Momo au réveil

CYCLE 11 (demande explicite) entièrement traité + loop d'amélioration continue tournée
7 itérations cette nuit, arrêtée proprement à l'itération 7 après 2 itérations consécutives
(6 et 7) sans trouvaille sûre supplémentaire, conformément au critère de fin de GOAL.md.

## Résumé complet de la nuit

**CYCLE 11 (demande explicite Momo) :**
1. 6 dispositions d'appel (grid/spotlight/sidebar/presentation/focus/filmstrip)
2. Noise gate AudioWorklet en plus des filtres statiques
3. Caméra + écran simultanés et visibles par tous (2 senders vidéo distincts)
4. Audio système du partage d'écran mixé au micro (plus perdu/remplacé)

**Loop nocturne (7 itérations) :**
- it.1 : a11y switcher de disposition (commit 4b5055c)
- it.2 : BUG RÉEL — mix audio non propagé aux peers rejoignant en cours de partage (commit 062f612)
- it.3 : BUG RÉEL — mark_all_read (server) ignorait les échecs DB, renvoyait faux succès (commit f41549f)
- it.4 : nettoyage — 7 imports inutilisés retirés, cargo check 0 warning (commit f211f3e)
- it.5 : a11y Whiteboard (dialog, 5 outils, Escape) + Soundboard (commit e895ea8)
- it.6 : audits (modales a11y, tokio::join! serveur) → rien à corriger, + 2 eslint-disable morts supprimés, eslint 0 problème (commit 9ac230d)
- it.7 : audit sécurité (XSS markdown, injection liens, rate limiting auth) → tout déjà solide, rien à corriger. **Arrêt de la loop ici.**

Tous les commits poussés (forgejo + github), tous déployés et vérifiés en prod
(dernier commit vérifié sur VPS : 9ac230d, healthy).

## Finding NON corrigé — à faire valider par Momo avant d'y toucher

**Race potentielle de renégociation WebRTC dans `client/src/store/voice.ts`.**
`toggleVideo`/`shareScreen`/`stopScreenShare` appellent chacun `createOffer()` +
`setLocalDescription()` de façon ad-hoc, sans mutex/queue par `RTCPeerConnection`.
Si l'utilisateur déclenche 2 actions coup sur coup (ex: activer caméra PUIS partager
écran très vite), un 2e `createOffer()` pourrait survenir avant que le 1er ait atteint
`signalingState: "stable"`, cassant la négociation pour cette paire de pairs.

- Pas reproduit ni testé en conditions réelles (nécessite 2 pairs + clics rapides) —
  identifié par lecture de code, pas par un bug observé en prod.
- Fix propre = file d'attente de renégociation par `RTCPeerConnection` (sérialiser tous
  les `createOffer`/`setLocalDescription` d'un même pc).
- **Ne pas corriger sans validation humaine** — touche tous les points de renégociation
  de voice.ts, risque de casser la voix/vidéo en prod si mal fait.

## Piste écartée délibérément — à proposer pour une session dédiée

**Perf `MessageList.tsx`** (1562 lignes) : composant monolithique, aucun `React.memo`,
tous les messages re-rendent à chaque changement d'état local (hover, edit, etc.).
Extraction en sous-composant memoïsé par message = amélioration perf réelle sur les
canaux à beaucoup de messages, mais refactor multi-points dans un fichier énorme,
trop risqué à faire sans supervision/tests visuels. Bon candidat pour une session
normale avec `writing-plans` + vérification visuelle avant/après.

## Contexte pour reprendre (prochaine session normale, pas une loop)

- Repo : C:\Users\Momo\ForgeChat (client React/Vite/TS, server Rust/Axum, VPS 212.227.140.45)
- Déploiement : push vers `main` (forgejo + github) → CI Forgejo Actions déploie automatiquement
  (.forgejo/workflows/deploy.yml). NE PAS scp manuellement (redondant). Un changement server/
  déclenche un vrai rebuild Docker (~1-2 min) ; un changement client seul est quasi instantané.
  Vérifier : `ssh root@212.227.140.45 "cd /opt/forgechat && git rev-parse --short HEAD"`.
- Build : client → `cd client && npx eslint src && npx tsc --noEmit && npm run build` ;
  server → `cd server && cargo check`
- `.loop/JOURNAL.md` a le détail complet de chaque itération, `.loop/LESSONS.md` les leçons
  opérationnelles (déploiement, WebRTC, CI)
