# ForgeChat — Setup VPS (212.227.140.45)

## 1. Pré-requis sur le VPS

```bash
# Docker + Docker Compose
curl -fsSL https://get.docker.com | sh
usermod -aG docker $USER

# Certbot pour SSL
apt install -y certbot

# Git
apt install -y git
```

## 2. DNS — Ionos / Cloudflare

Ajoute un enregistrement A :
```
forgechat.heiphaistos.org  →  212.227.140.45
```

## 3. Premier déploiement

```bash
# Cloner le repo sur le VPS
git clone https://YOUR_REPO_URL /opt/forgechat
cd /opt/forgechat

# Configurer les secrets
cp .env.example .env
nano .env
# Remplir : POSTGRES_PASSWORD et JWT_SECRET (openssl rand -hex 32)
```

## 4. Certificat SSL (AVANT docker compose)

```bash
# Port 80 doit être libre
cd /opt/forgechat
./deploy.sh --ssl-only
```

## 5. Lancer ForgeChat

```bash
cd /opt/forgechat
./deploy.sh
```

## 6. Vérification

```bash
docker compose ps          # Tous les services "Up"
docker compose logs server  # Logs Rust
curl https://forgechat.heiphaistos.org/api/auth/register -d '{}'
# → {"error":"..."}  = serveur OK
```

## 7. Mises à jour

```bash
cd /opt/forgechat
git pull
./deploy.sh
```

## 8. Gestion

```bash
# Logs live
docker compose logs -f

# Restart un service
docker compose restart server

# Backup DB
docker compose exec postgres pg_dump -U forgechat forgechat > backup_$(date +%Y%m%d).sql

# Shell DB
docker compose exec postgres psql -U forgechat forgechat
```

## Variables .env requises

| Variable | Description | Exemple |
|----------|-------------|---------|
| `POSTGRES_PASSWORD` | Mot de passe PostgreSQL | `m0t_d3_p4sse` |
| `JWT_SECRET` | Secret JWT (min 64 chars) | `openssl rand -hex 32` |
| `FRONTEND_URL` | URL du site | `https://forgechat.heiphaistos.org` |

## CI/CD GitHub Actions (optionnel)

Dans les Secrets GitHub du repo :
- `VPS_HOST` = `212.227.140.45`
- `VPS_USER` = `root`
- `VPS_SSH_KEY` = contenu de `~/.ssh/id_rsa` (clé privée)

Push sur `main` → déploiement automatique.
