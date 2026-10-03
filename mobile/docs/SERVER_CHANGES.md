# Changements serveur pour le mobile

> État au 2026-10-03 : le serveur de référence (dépôt de Heiphaistos, commit `2dae54d`) n’a **pas**
> ces changements (push mobile, appel vers un mobile fermé, rejeu d’appel, déconnexion par appareil).
> Le reste de l’app est compatible (routes HTTP et événements WebSocket vérifiés). Appels et vocal :
> LiveKit (`docs/ARCHITECTURE.md`).

Tous rétro-compatibles : le client web et le desktop Tauri fonctionnent sans modification.
`cargo check` et `cargo test` passent.

| Fichier | Changement |
|---|---|
| `server/migrations/061_push_devices.sql` | Table `push_devices` + index sur les appels en sonnerie (migration jouée au démarrage) |
| `server/src/handlers/push.rs` | **Nouveau** : enregistrement des appareils, envoi Expo → APNs/FCM, purge des tokens invalides, anti-flood, tests unitaires |
| `server/src/main.rs` | Routes `POST /api/push/devices` et `DELETE /api/push/devices/:token` (authentifiées) |
| `server/src/config.rs` | `PUSH_ENABLED` (défaut `true`), `EXPO_ACCESS_TOKEN` (optionnel, recommandé) |
| `server/src/handlers/friends.rs` | Push sur DM reçu et demande d'ami |
| `server/src/handlers/group_dms.rs` | Push sur message de groupe |
| `server/src/handlers/messages.rs` | Push sur mention (`@pseudo`, `<@id>`, `@everyone` / `@here`) |
| `server/src/handlers/websocket.rs` | 1) appel vers un utilisateur hors ligne ayant l'app → push d'appel au lieu de « hors ligne » ; 2) rejeu de `DM_CALL_INCOMING` à la reconnexion ; 3) abonnement au canal de diffusion **avant** l'envoi de `PRESENCE_INIT` (corrige la perte du snapshot de présence) |
| `server/src/handlers/auth.rs` | `logout` : `scope: "current"` + `refresh_token` ne révoque que cet appareil (sinon comportement historique) ; nettoyage des sessions et appareils push à la déconnexion globale et au changement de mot de passe |
| `.env.example`, `docker-compose.yml` | Nouvelles variables `PUSH_ENABLED`, `EXPO_ACCESS_TOKEN` |

## Règles d'envoi des push

- Uniquement si le destinataire n'a **aucune** connexion WebSocket ouverte.
- Pas de push en « Ne pas déranger » ni pour un DM en sourdine.
- Contenu du message seulement si l'appareil l'a autorisé (`show_preview`), sinon texte générique.
- Données embarquées : identifiants uniquement (`kind`, `dm_id` / `group_id` / `server_id` + `channel_id`).
- Appels : priorité haute, canal Android « Appels », TTL 45 s.

## Déploiement

```bash
# .env du serveur
PUSH_ENABLED=true
EXPO_ACCESS_TOKEN=...   # expo.dev → projet → Access tokens (Enhanced Push Security)

docker compose up -d --build server
```
