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
- Réactions emoji avec picker et sync temps réel
- Fils de discussion (threads) avec scroll auto
- Mentions `@user` et `#channel` avec autocomplete
- Slowmode, messages épinglés, favoris

### Temps réel (WebSocket)
- Présence utilisateur (online/away/dnd/offline)
- Notifications de frappe
- Broadcast réactions, threads, messages
- Tickets WebSocket éphémères pour auth

### Sécurité
- JWT access token (15min) + refresh token httpOnly cookie
- Champ `iss` validé sur chaque requête
- Rate limiting par endpoint
- Vérification ownership sur toutes les ressources (anti-IDOR)
- CORS strict

### Fonctionnalités avancées
- Sondages, Forums, Flux RSS/Feeds
- DM privés et groupes DM
- Bots, Modération, Emojis personnalisés
- TURN/STUN WebRTC (coturn), Noise suppression
- 16 thèmes visuels, Slash commands, Templates

---

## Architecture

```
forgechat/
├── server/                  # Backend Rust (axum 0.7 + PostgreSQL + Redis)
│   └── src/
│       ├── handlers/        # auth, messages, channels, polls, bots, forum...
│       ├── config.rs
│       └── main.rs
├── client/                  # Frontend React 18 + Vite + Tailwind
│   └── src/
│       ├── api/
│       ├── components/
│       ├── pages/
│       └── store/           # Zustand
├── desktop/                 # App desktop
├── nginx.conf
├── docker-compose.yml
├── deploy.sh
└── .env.example
```

---

## Stack technique

| Couche | Technologie |
|--------|-------------|
| Backend | Rust + axum 0.7 + tokio |
| DB | PostgreSQL + sqlx 0.7 |
| Cache | Redis |
| Auth | JWT + bcrypt |
| WebSocket | axum ws |
| Email | lettre (SMTP) |
| Frontend | React 18 + TypeScript + Vite |
| UI | Radix UI + Tailwind CSS 3 |
| État | Zustand + TanStack Query |
| Animation | Framer Motion |

---

## Installation

### 1. Cloner et configurer

```bash
git clone https://github.com/votre-org/forgechat /opt/forgechat
cd /opt/forgechat
cp .env.example .env
```

### 2. Remplir `.env`

```env
POSTGRES_PASSWORD=<openssl rand -hex 24>
DATABASE_URL=postgres://forgechat:<POSTGRES_PASSWORD>@postgres:5432/forgechat
REDIS_URL=redis://redis:6379
JWT_SECRET=<openssl rand -hex 32>
FRONTEND_URL=https://votre-domaine.com
```

### 3. Déployer

```bash
# Développement
docker compose up -d

# Production (avec SSL)
./deploy.sh --ssl-only   # Certificat SSL d'abord
./deploy.sh              # Lancement complet
```

---

## Développement local

```bash
# Backend
cd server
cargo run
# → API http://localhost:3000

# Frontend
cd client
npm install && npm run dev
# → http://localhost:5173
```

---

## Variables d'environnement

| Variable | Description |
|----------|-------------|
| `POSTGRES_PASSWORD` | Mot de passe PostgreSQL |
| `DATABASE_URL` | URL connexion PostgreSQL |
| `REDIS_URL` | URL Redis |
| `JWT_SECRET` | Secret JWT (min 32 chars) |
| `FRONTEND_URL` | URL frontend (CORS) |
| `SMTP_HOST` | Serveur SMTP |
| `SMTP_USER` | Email expéditeur |
| `SMTP_PASSWORD` | Mot de passe SMTP |
| `TURN_SECRET` | Secret TURN WebRTC |

---

## API — Endpoints principaux

```
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/refresh
GET    /api/ws-ticket               # Ticket WebSocket éphémère
GET    /api/servers
POST   /api/servers
GET    /api/servers/:s/channels/:c/messages
POST   /api/servers/:s/channels/:c/messages
POST   /api/servers/:s/channels/:c/messages/:id/reactions
PATCH  /api/user/status
GET    /api/servers/discover
GET    /api/activity-feed
```

---

## Événements WebSocket

```json
{ "type": "MESSAGE_CREATE", "data": { "id": "...", "content": "...", "author": {...} } }
{ "type": "REACTION_ADD",   "data": { "message_id": "...", "emoji": "👍", "user_id": "..." } }
{ "type": "PRESENCE_UPDATE","data": { "user_id": "...", "status": "online" } }
{ "type": "THREAD_MESSAGE", "data": { "thread_id": "...", "content": "..." } }
```

---

## Licence

MIT — Voir [LICENSE](LICENSE) pour les détails.
