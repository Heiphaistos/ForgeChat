# ForgeChat

> Clone Discord self-hosted — messagerie temps réel complète avec serveurs, channels, DM, WebRTC vocal/vidéo, réactions, sondages, fils de discussion et bots.

[![Server](https://img.shields.io/badge/Backend-Rust%20%2B%20axum%20v2.4-orange)](#)
[![Client](https://img.shields.io/badge/Frontend-React%2018%20%2B%20TypeScript%20v3.2-blue)](#)
[![Database](https://img.shields.io/badge/DB-PostgreSQL%20%2B%20Redis-informational)](#)
[![WebSocket](https://img.shields.io/badge/Realtime-WebSocket-green)](#)
[![License](https://img.shields.io/badge/License-MIT-green)](#)

---

## Fonctionnalités

### Messagerie & Canaux
- Serveurs avec catégories et channels texte/vocal/vidéo
- Messages avec rich text (bold, italic, code, citations, blocs de code)
- Réactions emoji (picker 20 emojis, toggle add/remove temps réel)
- Fils de discussion (threads) avec scroll auto et sync WebSocket
- Mentions `@user` et `#channel` avec autocomplete
- Slowmode par channel
- Messages épinglés et favoris (`/saved`)

### Temps réel (WebSocket)
- Présence utilisateur (online/away/dnd/offline)
- Notifications de frappe
- `REACTION_ADD` / `REACTION_REMOVE` en broadcast
- `PRESENCE_UPDATE` en broadcast
- `THREAD_MESSAGE` et scroll auto
- Tickets WebSocket pour auth (wsticket)

### Sécurité
- JWT access token (15min) + refresh token httpOnly cookie
- Champ `iss` validé sur chaque requête
- PBKDF2 / bcrypt pour les mots de passe
- Rate limiting par endpoint
- Vérification ownership sur toutes les ressources (anti-IDOR)
- CORS strict

### Fonctionnalités avancées
- Sondages (polls) par channel
- Forums (posts threaded)
- Flux RSS/Feeds par serveur
- DM privés et groupes DM
- Amis, blocages
- Système de bots
- Modération (ban, kick, mute, slowmode)
- Emojis personnalisés par serveur
- Invitations avec lien
- Événements de serveur
- Slash commands
- Templates de serveur
- TURN/STUN pour WebRTC vocal/vidéo (coturn)
- Suppression du bruit (noise suppression)
- 16 thèmes visuels

---

## Architecture

```
forgechat/
├── server/                     # Backend Rust (axum)
│   ├── src/
│   │   ├── main.rs
│   │   ├── config.rs
│   │   ├── state.rs
│   │   ├── error.rs
│   │   ├── email.rs
│   │   └── handlers/
│   │       ├── auth.rs         # JWT, login, register, refresh
│   │       ├── messages.rs     # CRUD messages + WebSocket
│   │       ├── channels.rs     # Channels, catégories
│   │       ├── friends.rs      # Amis, blocages
│   │       ├── dm_extras.rs    # DM groupes
│   │       ├── polls.rs        # Sondages
│   │       ├── forum.rs        # Fils de forum
│   │       ├── feeds.rs        # Flux RSS
│   │       ├── bots.rs         # Système de bots
│   │       ├── moderation.rs   # Ban, kick, mute
│   │       ├── emojis.rs       # Emojis custom
│   │       ├── events.rs       # Événements serveur
│   │       ├── invites.rs      # Liens d'invitation
│   │       ├── audit.rs        # Logs d'audit
│   │       └── ...
│   └── Cargo.toml
├── client/                     # Frontend React 18 + Vite
│   ├── src/
│   │   ├── api/                # Appels axios
│   │   ├── components/         # Composants Radix UI
│   │   ├── hooks/              # Hooks React custom
│   │   ├── pages/              # Pages routées
│   │   ├── store/              # État Zustand
│   │   └── utils/
│   └── package.json
├── desktop/                    # App Electron/Tauri desktop
├── docs/                       # Documentation
├── nginx.conf                  # Reverse proxy + SSL
├── docker-compose.yml          # Orchestration complète
├── deploy.sh                   # Script de déploiement VPS
└── .env.example
```

---

## Stack technique

### Backend (`server/`)

| Composant | Technologie |
|-----------|-------------|
| Framework | axum 0.7 + tokio |
| Base de données | PostgreSQL (sqlx 0.7) |
| Cache / Pub-Sub | Redis (ioredis) |
| Auth | JWT (jsonwebtoken) + bcrypt |
| WebSocket | axum ws |
| Email | lettre (SMTP) |
| Logs | tracing + tracing-subscriber |

### Frontend (`client/`)

| Composant | Technologie |
|-----------|-------------|
| Framework | React 18 + TypeScript |
| Build | Vite |
| UI | Radix UI + Tailwind CSS |
| État global | Zustand + Immer |
| Data fetching | TanStack Query (React Query) |
| Animation | Framer Motion |
| HTTP | axios |
| Routing | React Router v6 |
| Virtualisation | react-virtuoso (listes longues) |

---

## Prérequis

- Docker & Docker Compose v2
- Un domaine avec entrée DNS A pointant vers le serveur
- Certbot (pour SSL en production)

---

## Installation

### 1. Cloner le dépôt

```bash
git clone https://github.com/votre-org/forgechat /opt/forgechat
cd /opt/forgechat
```

### 2. Configurer les secrets

```bash
cp .env.example .env
```

Éditer `.env` :

```env
# PostgreSQL
POSTGRES_PASSWORD=<générer avec: openssl rand -hex 24>

# Backend
DATABASE_URL=postgres://forgechat:<POSTGRES_PASSWORD>@postgres:5432/forgechat
REDIS_URL=redis://redis:6379
JWT_SECRET=<générer avec: openssl rand -hex 32>
FRONTEND_URL=https://votre-domaine.com

# TURN (optionnel, pour WebRTC vocal/vidéo)
TURN_SECRET=<générer avec: openssl rand -hex 32>
```

### 3. Déployer

```bash
# Développement local
docker compose up -d

# Production avec SSL
./deploy.sh --ssl-only   # Obtenir le certificat d'abord
./deploy.sh              # Lancer l'application complète
```

---

## Développement local

### Backend Rust

```bash
cd server

# Variables d'environnement
export DATABASE_URL="postgres://forgechat:secret@localhost:5432/forgechat"
export REDIS_URL="redis://localhost:6379"
export JWT_SECRET="dev_secret_change_in_prod"

# Lancer les migrations
cargo sqlx migrate run

# Démarrer en mode dev
cargo run
# → http://localhost:3000
```

### Frontend React

```bash
cd client

# Installer les dépendances
npm install

# Démarrer en mode dev
npm run dev
# → http://localhost:5173

# Build production
npm run build
```

---

## Variables d'environnement

| Variable | Description | Exemple |
|----------|-------------|---------|
| `POSTGRES_PASSWORD` | Mot de passe PostgreSQL | `openssl rand -hex 24` |
| `DATABASE_URL` | URL de connexion PostgreSQL | `postgres://user:pass@host/db` |
| `REDIS_URL` | URL Redis | `redis://redis:6379` |
| `JWT_SECRET` | Secret pour signer les JWT | `openssl rand -hex 32` |
| `FRONTEND_URL` | URL du frontend (CORS) | `https://votre-domaine.com` |
| `SMTP_HOST` | Serveur SMTP pour emails | `smtp.example.com` |
| `SMTP_USER` | Utilisateur SMTP | `noreply@example.com` |
| `SMTP_PASSWORD` | Mot de passe SMTP | — |
| `TURN_SECRET` | Secret TURN pour WebRTC | `openssl rand -hex 32` |

---

## Déploiement production

### Docker Compose

```bash
# Build et démarrage
docker compose up -d --build

# Logs
docker compose logs -f

# Redémarrage après mise à jour
git pull
docker compose up -d --build --no-deps server
docker compose up -d --build --no-deps client
```

### Migrations base de données

```bash
# Appliquer les migrations pending
docker compose exec server cargo sqlx migrate run

# Ou via le script de déploiement
./deploy.sh --migrate
```

---

## Structure WebSocket

Les messages WebSocket suivent ce format :

```json
{
  "type": "MESSAGE_CREATE",
  "data": {
    "id": "uuid-v4",
    "channel_id": "uuid-v4",
    "content": "Bonjour !",
    "author": { "id": "uuid", "username": "alice" },
    "created_at": "2026-01-01T00:00:00Z"
  }
}
```

**Types d'événements :**

| Event | Direction | Description |
|-------|-----------|-------------|
| `MESSAGE_CREATE` | Server → Client | Nouveau message |
| `MESSAGE_UPDATE` | Server → Client | Message édité |
| `MESSAGE_DELETE` | Server → Client | Message supprimé |
| `REACTION_ADD` | Server → Client | Réaction ajoutée |
| `REACTION_REMOVE` | Server → Client | Réaction retirée |
| `PRESENCE_UPDATE` | Server → Client | Statut utilisateur changé |
| `THREAD_MESSAGE` | Server → Client | Message dans un thread |
| `TYPING_START` | Client → Server | Indicateur de frappe |

---

## API REST — Endpoints principaux

```
POST   /api/auth/register        # Créer un compte
POST   /api/auth/login           # Se connecter
POST   /api/auth/refresh         # Rafraîchir le token
POST   /api/auth/logout          # Se déconnecter

GET    /api/servers              # Lister les serveurs de l'utilisateur
POST   /api/servers              # Créer un serveur
GET    /api/servers/:id/channels # Lister les channels d'un serveur

GET    /api/servers/:s/channels/:c/messages          # Messages d'un channel
POST   /api/servers/:s/channels/:c/messages          # Envoyer un message
PATCH  /api/servers/:s/channels/:c/messages/:id      # Éditer un message
DELETE /api/servers/:s/channels/:c/messages/:id      # Supprimer un message

POST   /api/servers/:s/channels/:c/messages/:id/reactions  # Ajouter une réaction

GET    /api/servers/discover     # Découvrir des serveurs publics
GET    /api/activity-feed        # Flux d'activité global

PATCH  /api/user/status          # Mettre à jour le statut
GET    /api/friends              # Liste des amis
POST   /api/friends/:id          # Envoyer une demande d'ami

GET    /api/ws-ticket            # Obtenir un ticket pour la connexion WebSocket
```

---

## Sécurité

- Tous les endpoints privés requièrent un Bearer token valide
- Chaque ressource vérifie le `user_id` du token contre le propriétaire (anti-IDOR)
- Rate limiting via Tower middleware
- Cookies `HttpOnly` + `Secure` + `SameSite=Strict`
- Ticket WebSocket éphémère (TTL 30s) pour éviter le token en query string

---

## Licence

MIT — Voir [LICENSE](LICENSE) pour les détails.
