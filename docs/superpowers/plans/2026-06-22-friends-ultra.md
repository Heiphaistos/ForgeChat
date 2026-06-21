# Friends Ultra — Système d'amis complet (Discord + Teams + TeamSpeak)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transformer le système d'amis basique de ForgeChat en un système ultra-complet avec notes, surnoms, groupes, suggestions, historique d'appels, épingles DM, mute/archive DM, notifications de présence, recherche avancée et interface entièrement repensée.

**Architecture:** Migration SQL 013 → nouveaux handlers Rust (friends.rs étendu + dm_extras.rs) → réécriture complète FriendsPage.tsx + composants. Toutes les données relationnelles (notes, surnoms, groupes) restent côté serveur pour la sync cross-device.

**Tech Stack:** Axum/sqlx (Rust) · React/TanStack Query · Lucide icons · Tailwind CSS

---

## Fichiers impactés

**Créer :**
- `server/migrations/013_friends_ultra.sql`
- `server/src/handlers/dm_extras.rs` (mute, archive, pins)
- `client/src/components/friends/FriendCard.tsx`
- `client/src/components/friends/FriendContextMenu.tsx`
- `client/src/components/friends/FriendGroupPanel.tsx`
- `client/src/components/friends/AddFriendModal.tsx`
- `client/src/components/friends/FriendNoteModal.tsx`

**Modifier :**
- `server/src/handlers/friends.rs` (+500 lignes : notes, surnoms, groupes, suggestions, notifs, appels)
- `server/src/handlers/mod.rs` (ajouter dm_extras)
- `server/src/main.rs` (+30 routes)
- `client/src/pages/FriendsPage.tsx` (réécriture complète)

---

## Task 1 — Migration SQL 013

**Files:** Create `server/migrations/013_friends_ultra.sql`

- [ ] **Écrire la migration**

```sql
-- Notes privées sur les amis
CREATE TABLE IF NOT EXISTS friend_notes (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    note       TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, target_id)
);

-- Surnoms personnalisés pour les amis
CREATE TABLE IF NOT EXISTS friend_nicknames (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nickname   VARCHAR(64) NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, target_id)
);

-- Groupes d'amis (catégories)
CREATE TABLE IF NOT EXISTS friend_groups (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       VARCHAR(64) NOT NULL,
    color      VARCHAR(16),
    position   INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Membres des groupes d'amis
CREATE TABLE IF NOT EXISTS friend_group_members (
    group_id  UUID NOT NULL REFERENCES friend_groups(id) ON DELETE CASCADE,
    user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, user_id)
);

-- Notifications de connexion (alerter quand l'ami se connecte)
CREATE TABLE IF NOT EXISTS friend_online_notifs (
    user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, target_id)
);

-- Historique des appels
CREATE TABLE IF NOT EXISTS call_history (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    caller_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    callee_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dm_id      UUID REFERENCES dm_channels(id) ON DELETE SET NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at   TIMESTAMPTZ,
    duration_s INT,
    call_type  VARCHAR(10) NOT NULL DEFAULT 'voice',
    status     VARCHAR(10) NOT NULL DEFAULT 'missed'
);

-- Messages épinglés en DM
CREATE TABLE IF NOT EXISTS dm_pins (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dm_channel_id UUID NOT NULL REFERENCES dm_channels(id) ON DELETE CASCADE,
    message_id    UUID NOT NULL REFERENCES dm_messages(id) ON DELETE CASCADE,
    pinned_by     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pinned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (dm_channel_id, message_id)
);

-- Extensions dm_channels : archive, mute, dernière activité
ALTER TABLE dm_channels ADD COLUMN IF NOT EXISTS archived_by_user1  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE dm_channels ADD COLUMN IF NOT EXISTS archived_by_user2  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE dm_channels ADD COLUMN IF NOT EXISTS muted_by_user1_until TIMESTAMPTZ;
ALTER TABLE dm_channels ADD COLUMN IF NOT EXISTS muted_by_user2_until TIMESTAMPTZ;
ALTER TABLE dm_channels ADD COLUMN IF NOT EXISTS last_message_at    TIMESTAMPTZ;
ALTER TABLE dm_channels ADD COLUMN IF NOT EXISTS last_message_preview VARCHAR(200);

-- Extensions friendships : message de demande + ami depuis
ALTER TABLE friendships ADD COLUMN IF NOT EXISTS message    TEXT;
ALTER TABLE friendships ADD COLUMN IF NOT EXISTS friend_since TIMESTAMPTZ;

-- Index performances
CREATE INDEX IF NOT EXISTS idx_friend_notes_user      ON friend_notes(user_id);
CREATE INDEX IF NOT EXISTS idx_friend_groups_user     ON friend_groups(user_id);
CREATE INDEX IF NOT EXISTS idx_call_history_caller    ON call_history(caller_id);
CREATE INDEX IF NOT EXISTS idx_call_history_callee    ON call_history(callee_id);
CREATE INDEX IF NOT EXISTS idx_dm_pins_channel        ON dm_pins(dm_channel_id);
```

---

## Task 2 — Backend : nouveaux handlers friends.rs

**Files:** Modify `server/src/handlers/friends.rs`

Ajouter APRÈS les handlers existants (après `send_e2e_message`).

- [ ] **Ajouter les imports manquants en haut du fichier**

```rust
use axum::extract::Query;
use std::collections::HashMap;
```

- [ ] **Handler : recherche par username#discriminator**

```rust
#[derive(serde::Deserialize)]
pub struct AddByNameBody {
    pub name: String,      // "username" ou "username#1234"
    pub message: Option<String>,
}

pub async fn send_friend_by_name(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<AddByNameBody>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;

    let (username, discriminator) = if body.name.contains('#') {
        let parts: Vec<&str> = body.name.splitn(2, '#').collect();
        (parts[0].to_lowercase(), Some(parts[1].to_string()))
    } else {
        (body.name.to_lowercase(), None)
    };

    let target = if let Some(disc) = discriminator {
        sqlx::query("SELECT id FROM users WHERE LOWER(username)=$1 AND discriminator=$2")
            .bind(&username).bind(&disc)
            .fetch_optional(&state.db).await?
    } else {
        sqlx::query("SELECT id FROM users WHERE LOWER(username)=$1 LIMIT 1")
            .bind(&username)
            .fetch_optional(&state.db).await?
    };

    let target = target.ok_or_else(|| AppError::NotFound("Utilisateur introuvable".into()))?;
    let target_id: Uuid = target.get("id");

    if target_id == claims.sub {
        return Err(AppError::BadRequest("Impossible de s'ajouter soi-même".into()));
    }

    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM friendships WHERE (user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1))"
    ).bind(claims.sub).bind(target_id).fetch_one(&state.db).await?;

    if exists {
        return Err(AppError::Conflict("Relation déjà existante".into()));
    }

    let msg = body.message.as_deref().unwrap_or("").chars().take(256).collect::<String>();
    sqlx::query(
        "INSERT INTO friendships (user_id, friend_id, status, message) VALUES ($1, $2, 'pending', $3)"
    ).bind(claims.sub).bind(target_id).bind(&msg).execute(&state.db).await?;

    let event = serde_json::json!({ "type": "FRIEND_REQUEST", "from_id": claims.sub });
    state.broadcast_to_user(target_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true, "user_id": target_id })))
}
```

- [ ] **Handler : liste enrichie (search + filter)**

```rust
pub async fn get_friends_v2(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;

    let filter = params.get("filter").map(|s| s.as_str()).unwrap_or("all");
    let q = params.get("q").cloned().unwrap_or_default().to_lowercase();

    let friends = sqlx::query(
        "SELECT f.id, f.friend_id, f.user_id as initiator_id, f.status, f.message, f.created_at as requested_at, f.friend_since,
                u.username, u.discriminator, u.avatar, u.status as user_status, u.custom_status,
                u.activity_type, u.activity_name,
                fn2.nickname as custom_nickname,
                EXISTS(SELECT 1 FROM friend_online_notifs fon WHERE fon.user_id=$1 AND fon.target_id=u.id) as notify_online
         FROM friendships f
         JOIN users u ON u.id = CASE WHEN f.user_id=$1 THEN f.friend_id ELSE f.user_id END
         LEFT JOIN friend_nicknames fn2 ON fn2.user_id=$1 AND fn2.target_id=u.id
         WHERE f.user_id=$1 OR (f.friend_id=$1 AND f.status='accepted')
         ORDER BY u.username"
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    let mut result: Vec<serde_json::Value> = friends.iter()
        .filter(|r| {
            let status: String = r.get("status");
            let username: String = r.get("username");
            let initiator_id: Uuid = r.get("initiator_id");

            let pass_filter = match filter {
                "online" => status == "accepted" && r.get::<String, _>("user_status") == "online",
                "pending" => status == "pending",
                "pending_sent" => status == "pending" && initiator_id == claims.sub,
                "pending_received" => status == "pending" && initiator_id != claims.sub,
                "blocked" => false, // géré séparément
                _ => status == "accepted",
            };
            let pass_search = q.is_empty() || username.to_lowercase().contains(&q);
            pass_filter && pass_search
        })
        .map(|r| {
            let initiator_id: Uuid = r.get("initiator_id");
            let status: String = r.get("status");
            let direction = if status == "pending" {
                if initiator_id == claims.sub { "sent" } else { "received" }
            } else { "accepted" };
            serde_json::json!({
                "id": r.get::<Uuid, _>("id"),
                "friend_id": r.get::<Uuid, _>("friend_id"),
                "status": r.get::<String, _>("status"),
                "direction": direction,
                "message": r.get::<Option<String>, _>("message"),
                "friend_since": r.get::<Option<chrono::DateTime<chrono::Utc>>, _>("friend_since"),
                "username": r.get::<String, _>("username"),
                "discriminator": r.get::<String, _>("discriminator"),
                "avatar": r.get::<Option<String>, _>("avatar"),
                "user_status": r.get::<String, _>("user_status"),
                "custom_status": r.get::<Option<String>, _>("custom_status"),
                "activity_type": r.get::<Option<String>, _>("activity_type"),
                "activity_name": r.get::<Option<String>, _>("activity_name"),
                "custom_nickname": r.get::<Option<String>, _>("custom_nickname"),
                "notify_online": r.get::<bool, _>("notify_online"),
            })
        })
        .collect();

    // Bloqués (séparé)
    let blocked = if filter == "blocked" {
        sqlx::query(
            "SELECT b.blocked_id, u.username, u.discriminator, u.avatar
             FROM blocks b JOIN users u ON u.id = b.blocked_id
             WHERE b.blocker_id=$1 ORDER BY u.username"
        )
        .bind(claims.sub).fetch_all(&state.db).await?
        .iter().map(|r| serde_json::json!({
            "id": r.get::<Uuid, _>("blocked_id"),
            "friend_id": r.get::<Uuid, _>("blocked_id"),
            "status": "blocked",
            "username": r.get::<String, _>("username"),
            "discriminator": r.get::<String, _>("discriminator"),
            "avatar": r.get::<Option<String>, _>("avatar"),
        })).collect::<Vec<_>>()
    } else { vec![] };

    if filter == "blocked" {
        result = blocked;
    }

    // Comptes totaux
    let counts = serde_json::json!({
        "all": friends.iter().filter(|r| r.get::<String, _>("status") == "accepted").count(),
        "online": friends.iter().filter(|r| r.get::<String, _>("status") == "accepted" && r.get::<String, _>("user_status") == "online").count(),
        "pending": friends.iter().filter(|r| r.get::<String, _>("status") == "pending").count(),
        "pending_received": friends.iter().filter(|r| {
            r.get::<String, _>("status") == "pending" && r.get::<Uuid, _>("initiator_id") != claims.sub
        }).count(),
    });

    Ok(Json(serde_json::json!({ "friends": result, "counts": counts })))
}
```

- [ ] **Handler : note privée (GET + PUT)**

```rust
pub async fn get_friend_note(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(target_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;
    let row = sqlx::query(
        "SELECT note, updated_at FROM friend_notes WHERE user_id=$1 AND target_id=$2"
    ).bind(claims.sub).bind(target_id).fetch_optional(&state.db).await?;

    let (note, updated_at) = row.map(|r| (
        r.get::<String, _>("note"),
        Some(r.get::<chrono::DateTime<chrono::Utc>, _>("updated_at"))
    )).unwrap_or_default();

    Ok(Json(serde_json::json!({ "note": note, "updated_at": updated_at })))
}

#[derive(serde::Deserialize)]
pub struct NoteBody { pub note: String }

pub async fn set_friend_note(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(target_id): Path<Uuid>,
    Json(body): Json<NoteBody>,
) -> Result<Json<serde_json::Value>> {
    let note = body.note.chars().take(2000).collect::<String>();
    sqlx::query(
        "INSERT INTO friend_notes (user_id, target_id, note, updated_at) VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id, target_id) DO UPDATE SET note=EXCLUDED.note, updated_at=NOW()"
    ).bind(claims.sub).bind(target_id).bind(&note).execute(&state.db).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
```

- [ ] **Handler : surnom (GET + PUT)**

```rust
pub async fn get_friend_nickname(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(target_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;
    let row = sqlx::query(
        "SELECT nickname FROM friend_nicknames WHERE user_id=$1 AND target_id=$2"
    ).bind(claims.sub).bind(target_id).fetch_optional(&state.db).await?;
    let nickname = row.map(|r| r.get::<String, _>("nickname")).unwrap_or_default();
    Ok(Json(serde_json::json!({ "nickname": nickname })))
}

#[derive(serde::Deserialize)]
pub struct NicknameBody { pub nickname: String }

pub async fn set_friend_nickname(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(target_id): Path<Uuid>,
    Json(body): Json<NicknameBody>,
) -> Result<Json<serde_json::Value>> {
    let nickname = body.nickname.trim().chars().take(64).collect::<String>();
    if nickname.is_empty() {
        sqlx::query("DELETE FROM friend_nicknames WHERE user_id=$1 AND target_id=$2")
            .bind(claims.sub).bind(target_id).execute(&state.db).await?;
    } else {
        sqlx::query(
            "INSERT INTO friend_nicknames (user_id, target_id, nickname) VALUES ($1, $2, $3)
             ON CONFLICT (user_id, target_id) DO UPDATE SET nickname=EXCLUDED.nickname, updated_at=NOW()"
        ).bind(claims.sub).bind(target_id).bind(&nickname).execute(&state.db).await?;
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}
```

- [ ] **Handlers : groupes d'amis (CRUD complet)**

```rust
pub async fn list_friend_groups(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<serde_json::Value>>> {
    use sqlx::Row;
    let groups = sqlx::query(
        "SELECT fg.id, fg.name, fg.color, fg.position,
                COALESCE(ARRAY_AGG(fgm.user_id) FILTER (WHERE fgm.user_id IS NOT NULL), '{}') as member_ids
         FROM friend_groups fg
         LEFT JOIN friend_group_members fgm ON fgm.group_id = fg.id
         WHERE fg.user_id=$1
         GROUP BY fg.id ORDER BY fg.position, fg.name"
    ).bind(claims.sub).fetch_all(&state.db).await?;

    let result = groups.iter().map(|r| serde_json::json!({
        "id": r.get::<Uuid, _>("id"),
        "name": r.get::<String, _>("name"),
        "color": r.get::<Option<String>, _>("color"),
        "position": r.get::<i32, _>("position"),
        "member_ids": r.get::<Vec<Uuid>, _>("member_ids"),
    })).collect();
    Ok(Json(result))
}

#[derive(serde::Deserialize)]
pub struct GroupBody { pub name: String, pub color: Option<String> }

pub async fn create_friend_group(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<GroupBody>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;
    let name = body.name.trim().chars().take(64).collect::<String>();
    if name.is_empty() { return Err(AppError::BadRequest("Nom requis".into())); }
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM friend_groups WHERE user_id=$1")
        .bind(claims.sub).fetch_one(&state.db).await?;
    if count >= 20 { return Err(AppError::BadRequest("Maximum 20 groupes".into())); }

    let row = sqlx::query(
        "INSERT INTO friend_groups (user_id, name, color, position) VALUES ($1, $2, $3, $4) RETURNING id"
    ).bind(claims.sub).bind(&name).bind(&body.color).bind(count as i32)
     .fetch_one(&state.db).await?;

    Ok(Json(serde_json::json!({ "id": row.get::<Uuid, _>("id"), "name": name })))
}

#[derive(serde::Deserialize)]
pub struct GroupUpdateBody { pub name: Option<String>, pub color: Option<String>, pub position: Option<i32> }

pub async fn update_friend_group(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(group_id): Path<Uuid>,
    Json(body): Json<GroupUpdateBody>,
) -> Result<Json<serde_json::Value>> {
    if let Some(ref name) = body.name {
        sqlx::query("UPDATE friend_groups SET name=$1 WHERE id=$2 AND user_id=$3")
            .bind(name.trim().chars().take(64).collect::<String>())
            .bind(group_id).bind(claims.sub).execute(&state.db).await?;
    }
    if let Some(ref color) = body.color {
        sqlx::query("UPDATE friend_groups SET color=$1 WHERE id=$2 AND user_id=$3")
            .bind(color).bind(group_id).bind(claims.sub).execute(&state.db).await?;
    }
    if let Some(pos) = body.position {
        sqlx::query("UPDATE friend_groups SET position=$1 WHERE id=$2 AND user_id=$3")
            .bind(pos).bind(group_id).bind(claims.sub).execute(&state.db).await?;
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn delete_friend_group(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(group_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    sqlx::query("DELETE FROM friend_groups WHERE id=$1 AND user_id=$2")
        .bind(group_id).bind(claims.sub).execute(&state.db).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(serde::Deserialize)]
pub struct GroupMemberBody { pub user_id: Uuid }

pub async fn add_to_group(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(group_id): Path<Uuid>,
    Json(body): Json<GroupMemberBody>,
) -> Result<Json<serde_json::Value>> {
    let owns = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM friend_groups WHERE id=$1 AND user_id=$2)"
    ).bind(group_id).bind(claims.sub).fetch_one(&state.db).await?;
    if !owns { return Err(AppError::Forbidden); }

    sqlx::query(
        "INSERT INTO friend_group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING"
    ).bind(group_id).bind(body.user_id).execute(&state.db).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn remove_from_group(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((group_id, user_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    let owns = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM friend_groups WHERE id=$1 AND user_id=$2)"
    ).bind(group_id).bind(claims.sub).fetch_one(&state.db).await?;
    if !owns { return Err(AppError::Forbidden); }

    sqlx::query("DELETE FROM friend_group_members WHERE group_id=$1 AND user_id=$2")
        .bind(group_id).bind(user_id).execute(&state.db).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
```

- [ ] **Handler : notification de connexion (toggle)**

```rust
#[derive(serde::Deserialize)]
pub struct NotifyBody { pub enabled: bool }

pub async fn set_online_notify(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(target_id): Path<Uuid>,
    Json(body): Json<NotifyBody>,
) -> Result<Json<serde_json::Value>> {
    if body.enabled {
        sqlx::query(
            "INSERT INTO friend_online_notifs (user_id, target_id) VALUES ($1, $2) ON CONFLICT DO NOTHING"
        ).bind(claims.sub).bind(target_id).execute(&state.db).await?;
    } else {
        sqlx::query("DELETE FROM friend_online_notifs WHERE user_id=$1 AND target_id=$2")
            .bind(claims.sub).bind(target_id).execute(&state.db).await?;
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}
```

- [ ] **Handler : suggestions d'amis**

```rust
pub async fn get_friend_suggestions(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<serde_json::Value>>> {
    use sqlx::Row;
    // Personnes avec amis en commun OU serveurs en commun, pas encore amis
    let suggestions = sqlx::query(
        "WITH my_friends AS (
            SELECT CASE WHEN user_id=$1 THEN friend_id ELSE user_id END as fid
            FROM friendships WHERE (user_id=$1 OR friend_id=$1) AND status='accepted'
         ),
         mutual_friends AS (
            SELECT CASE WHEN f.user_id IN (SELECT fid FROM my_friends) THEN f.friend_id ELSE f.user_id END as candidate,
                   COUNT(*) as mutual_count
            FROM friendships f
            WHERE (f.user_id IN (SELECT fid FROM my_friends) OR f.friend_id IN (SELECT fid FROM my_friends))
              AND f.status='accepted'
              AND f.user_id != $1 AND f.friend_id != $1
            GROUP BY candidate
         ),
         mutual_servers AS (
            SELECT sm2.user_id as candidate, COUNT(*) as server_count
            FROM server_members sm1
            JOIN server_members sm2 ON sm1.server_id = sm2.server_id AND sm2.user_id != $1
            WHERE sm1.user_id = $1 AND sm2.user_id != $1
            GROUP BY sm2.user_id
         ),
         existing AS (
            SELECT CASE WHEN user_id=$1 THEN friend_id ELSE user_id END as uid
            FROM friendships WHERE user_id=$1 OR friend_id=$1
         ),
         blocked_ids AS (
            SELECT blocked_id FROM blocks WHERE blocker_id=$1
         )
         SELECT u.id, u.username, u.discriminator, u.avatar, u.status,
                COALESCE(mf.mutual_count, 0) as mutual_friends,
                COALESCE(ms.server_count, 0) as mutual_servers
         FROM users u
         LEFT JOIN mutual_friends mf ON mf.candidate = u.id
         LEFT JOIN mutual_servers ms ON ms.candidate = u.id
         WHERE u.id != $1
           AND u.id NOT IN (SELECT uid FROM existing)
           AND u.id NOT IN (SELECT blocked_id FROM blocked_ids)
           AND (mf.mutual_count > 0 OR ms.server_count > 0)
         ORDER BY COALESCE(mf.mutual_count, 0) * 3 + COALESCE(ms.server_count, 0) DESC
         LIMIT 20"
    ).bind(claims.sub).fetch_all(&state.db).await?;

    let result = suggestions.iter().map(|r| serde_json::json!({
        "id": r.get::<Uuid, _>("id"),
        "username": r.get::<String, _>("username"),
        "discriminator": r.get::<String, _>("discriminator"),
        "avatar": r.get::<Option<String>, _>("avatar"),
        "status": r.get::<String, _>("status"),
        "mutual_friends": r.get::<i64, _>("mutual_friends"),
        "mutual_servers": r.get::<i64, _>("mutual_servers"),
    })).collect();
    Ok(Json(result))
}
```

- [ ] **Handler : annuler une demande envoyée**

```rust
pub async fn cancel_friend_request(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(friendship_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    sqlx::query(
        "DELETE FROM friendships WHERE id=$1 AND user_id=$2 AND status='pending'"
    ).bind(friendship_id).bind(claims.sub).execute(&state.db).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
```

- [ ] **Handler : historique d'appels**

```rust
pub async fn get_call_history(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<serde_json::Value>>> {
    use sqlx::Row;
    let calls = sqlx::query(
        "SELECT ch.id, ch.caller_id, ch.callee_id, ch.call_type, ch.status,
                ch.started_at, ch.ended_at, ch.duration_s, ch.dm_id,
                uc.username as caller_name, uc.avatar as caller_avatar,
                ue.username as callee_name, ue.avatar as callee_avatar
         FROM call_history ch
         JOIN users uc ON uc.id = ch.caller_id
         JOIN users ue ON ue.id = ch.callee_id
         WHERE ch.caller_id=$1 OR ch.callee_id=$1
         ORDER BY ch.started_at DESC LIMIT 50"
    ).bind(claims.sub).fetch_all(&state.db).await?;

    let result = calls.iter().map(|r| {
        let is_outgoing = r.get::<Uuid, _>("caller_id") == claims.sub;
        serde_json::json!({
            "id": r.get::<Uuid, _>("id"),
            "call_type": r.get::<String, _>("call_type"),
            "status": r.get::<String, _>("status"),
            "direction": if is_outgoing { "outgoing" } else { "incoming" },
            "started_at": r.get::<chrono::DateTime<chrono::Utc>, _>("started_at"),
            "ended_at": r.get::<Option<chrono::DateTime<chrono::Utc>>, _>("ended_at"),
            "duration_s": r.get::<Option<i32>, _>("duration_s"),
            "dm_id": r.get::<Option<Uuid>, _>("dm_id"),
            "other_user": {
                "id": if is_outgoing { r.get::<Uuid, _>("callee_id") } else { r.get::<Uuid, _>("caller_id") },
                "username": if is_outgoing { r.get::<String, _>("callee_name") } else { r.get::<String, _>("caller_name") },
                "avatar": if is_outgoing { r.get::<Option<String>, _>("callee_avatar") } else { r.get::<Option<String>, _>("caller_avatar") },
            },
        })
    }).collect();
    Ok(Json(result))
}
```

---

## Task 3 — Backend : dm_extras.rs (mute, archive, pins)

**Files:** Create `server/src/handlers/dm_extras.rs`

- [ ] **Créer le fichier complet**

```rust
use axum::{extract::{Path, State}, Extension, Json};
use uuid::Uuid;
use crate::{error::{AppError, Result}, middleware::auth::Claims, state::AppState};

async fn assert_dm_member(db: &sqlx::PgPool, dm_id: Uuid, user_id: Uuid) -> Result<()> {
    let ok = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM dm_channels WHERE id=$1 AND (user1_id=$2 OR user2_id=$2))"
    ).bind(dm_id).bind(user_id).fetch_one(db).await?;
    if !ok { return Err(AppError::Forbidden); }
    Ok(())
}

fn is_user1(row: &sqlx::postgres::PgRow, user_id: Uuid) -> bool {
    use sqlx::Row;
    row.get::<Uuid, _>("user1_id") == user_id
}

// ── Mute ──────────────────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
pub struct MuteBody { pub minutes: Option<i64> }  // None = indéfiniment

pub async fn mute_dm(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(dm_id): Path<Uuid>,
    Json(body): Json<MuteBody>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;
    assert_dm_member(&state.db, dm_id, claims.sub).await?;
    let row = sqlx::query("SELECT user1_id FROM dm_channels WHERE id=$1")
        .bind(dm_id).fetch_one(&state.db).await?;
    let col = if is_user1(&row, claims.sub) { "muted_by_user1_until" } else { "muted_by_user2_until" };
    let until = body.minutes.map(|m| chrono::Utc::now() + chrono::Duration::minutes(m));
    let sql = format!("UPDATE dm_channels SET {col}=$1 WHERE id=$2");
    sqlx::query(&sql).bind(until).bind(dm_id).execute(&state.db).await?;
    Ok(Json(serde_json::json!({ "ok": true, "muted_until": until })))
}

pub async fn unmute_dm(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(dm_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;
    assert_dm_member(&state.db, dm_id, claims.sub).await?;
    let row = sqlx::query("SELECT user1_id FROM dm_channels WHERE id=$1")
        .bind(dm_id).fetch_one(&state.db).await?;
    let col = if is_user1(&row, claims.sub) { "muted_by_user1_until" } else { "muted_by_user2_until" };
    let sql = format!("UPDATE dm_channels SET {col}=NULL WHERE id=$2");
    sqlx::query(&sql).bind(dm_id).execute(&state.db).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ── Archive ────────────────────────────────────────────────────────────────

pub async fn archive_dm(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(dm_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;
    assert_dm_member(&state.db, dm_id, claims.sub).await?;
    let row = sqlx::query("SELECT user1_id FROM dm_channels WHERE id=$1")
        .bind(dm_id).fetch_one(&state.db).await?;
    let col = if is_user1(&row, claims.sub) { "archived_by_user1" } else { "archived_by_user2" };
    let sql = format!("UPDATE dm_channels SET {col}=TRUE WHERE id=$2");
    sqlx::query(&sql).bind(dm_id).execute(&state.db).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn unarchive_dm(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(dm_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;
    assert_dm_member(&state.db, dm_id, claims.sub).await?;
    let row = sqlx::query("SELECT user1_id FROM dm_channels WHERE id=$1")
        .bind(dm_id).fetch_one(&state.db).await?;
    let col = if is_user1(&row, claims.sub) { "archived_by_user1" } else { "archived_by_user2" };
    let sql = format!("UPDATE dm_channels SET {col}=FALSE WHERE id=$2");
    sqlx::query(&sql).bind(dm_id).execute(&state.db).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ── Pins ────────────────────────────────────────────────────────────────────

pub async fn get_dm_pins(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(dm_id): Path<Uuid>,
) -> Result<Json<Vec<serde_json::Value>>> {
    use sqlx::Row;
    assert_dm_member(&state.db, dm_id, claims.sub).await?;
    let pins = sqlx::query(
        "SELECT dp.id, dp.message_id, dp.pinned_at, dp.pinned_by,
                dm.content, dm.sender_id, dm.created_at as msg_created_at,
                u.username as sender_name, u.avatar as sender_avatar,
                pu.username as pinner_name
         FROM dm_pins dp
         JOIN dm_messages dm ON dm.id = dp.message_id
         JOIN users u ON u.id = dm.sender_id
         JOIN users pu ON pu.id = dp.pinned_by
         WHERE dp.dm_channel_id=$1
         ORDER BY dp.pinned_at DESC"
    ).bind(dm_id).fetch_all(&state.db).await?;

    let result = pins.iter().map(|r| serde_json::json!({
        "id": r.get::<Uuid, _>("id"),
        "message_id": r.get::<Uuid, _>("message_id"),
        "pinned_at": r.get::<chrono::DateTime<chrono::Utc>, _>("pinned_at"),
        "pinned_by": r.get::<String, _>("pinner_name"),
        "message": {
            "content": r.get::<Option<String>, _>("content"),
            "sender_id": r.get::<Uuid, _>("sender_id"),
            "sender_name": r.get::<String, _>("sender_name"),
            "sender_avatar": r.get::<Option<String>, _>("sender_avatar"),
            "created_at": r.get::<chrono::DateTime<chrono::Utc>, _>("msg_created_at"),
        }
    })).collect();
    Ok(Json(result))
}

pub async fn pin_dm_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((dm_id, message_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    assert_dm_member(&state.db, dm_id, claims.sub).await?;
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM dm_pins WHERE dm_channel_id=$1")
        .bind(dm_id).fetch_one(&state.db).await?;
    if count >= 50 { return Err(AppError::BadRequest("Maximum 50 messages épinglés".into())); }

    sqlx::query(
        "INSERT INTO dm_pins (dm_channel_id, message_id, pinned_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING"
    ).bind(dm_id).bind(message_id).bind(claims.sub).execute(&state.db).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn unpin_dm_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((dm_id, message_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    assert_dm_member(&state.db, dm_id, claims.sub).await?;
    sqlx::query("DELETE FROM dm_pins WHERE dm_channel_id=$1 AND message_id=$2")
        .bind(dm_id).bind(message_id).execute(&state.db).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
```

---

## Task 4 — Backend : mod.rs + main.rs (routes)

**Files:** Modify `server/src/handlers/mod.rs`, `server/src/main.rs`

- [ ] **mod.rs : ajouter le module dm_extras**

Dans `pub mod` existants, ajouter :
```rust
pub mod dm_extras;
```

- [ ] **main.rs : ajouter ~25 routes dans protected_routes()**

```rust
// ── Friends ultra ──────────────────────────────────────────────────────────
.route("/friends/v2", get(handlers::friends::get_friends_v2))
.route("/friends/by-name", post(handlers::friends::send_friend_by_name))
.route("/friends/suggestions", get(handlers::friends::get_friend_suggestions))
.route("/friends/calls", get(handlers::friends::get_call_history))
.route("/friends/groups", get(handlers::friends::list_friend_groups))
.route("/friends/groups", post(handlers::friends::create_friend_group))
.route("/friends/groups/:id", put(handlers::friends::update_friend_group))
.route("/friends/groups/:id", delete(handlers::friends::delete_friend_group))
.route("/friends/groups/:id/members", post(handlers::friends::add_to_group))
.route("/friends/groups/:id/members/:user_id", delete(handlers::friends::remove_from_group))
.route("/friends/:id/cancel", delete(handlers::friends::cancel_friend_request))
.route("/friends/:id/note", get(handlers::friends::get_friend_note))
.route("/friends/:id/note", put(handlers::friends::set_friend_note))
.route("/friends/:id/nickname", get(handlers::friends::get_friend_nickname))
.route("/friends/:id/nickname", put(handlers::friends::set_friend_nickname))
.route("/friends/:id/notify", put(handlers::friends::set_online_notify))
// ── DM extras ──────────────────────────────────────────────────────────────
.route("/dms/:id/mute", post(handlers::dm_extras::mute_dm))
.route("/dms/:id/mute", delete(handlers::dm_extras::unmute_dm))
.route("/dms/:id/archive", post(handlers::dm_extras::archive_dm))
.route("/dms/:id/archive", delete(handlers::dm_extras::unarchive_dm))
.route("/dms/:id/pins", get(handlers::dm_extras::get_dm_pins))
.route("/dms/:id/pins/:msg_id", post(handlers::dm_extras::pin_dm_message))
.route("/dms/:id/pins/:msg_id", delete(handlers::dm_extras::unpin_dm_message))
```

---

## Task 5 — Frontend : FriendsPage.tsx complète réécriture

**Files:** Rewrite `client/src/pages/FriendsPage.tsx`

- [ ] **Réécrire la page complète**

```tsx
import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  UserPlus, MessageCircle, Phone, VideoIcon, Search, Link, Copy, Check, X,
  Users, Clock, Ban, Sparkles, ChevronDown, ChevronRight, MoreVertical,
  Bell, BellOff, Star, StarOff, StickyNote, Edit3, UserMinus, Volume2, VolumeX,
  Archive, ArchiveRestore, Pin, PhoneCall, PhoneMissed, PhoneIncoming
} from 'lucide-react'
import api from '../api/client'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import { format, formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'

type Tab = 'online' | 'all' | 'pending' | 'blocked' | 'suggestions' | 'calls'

const STATUS_COLOR: Record<string, string> = {
  online: 'bg-green-500', idle: 'bg-yellow-500',
  dnd: 'bg-red-500', offline: 'bg-gray-500', invisible: 'bg-gray-500',
}
const STATUS_LABEL: Record<string, string> = {
  online: 'En ligne', idle: 'Absent', dnd: 'Ne pas déranger', offline: 'Hors ligne', invisible: 'Invisible',
}

// ── Avatar ───────────────────────────────────────────────────────────────────
function Avatar({ user, size = 10 }: { user: any; size?: number }) {
  const cls = `w-${size} h-${size}`
  return (
    <div className={`${cls} rounded-full relative flex-shrink-0`}>
      {user.avatar
        ? <img src={user.avatar} alt="" className={`${cls} rounded-full object-cover`} />
        : <div className={`${cls} rounded-full bg-fc-accent flex items-center justify-center font-bold text-white text-sm`}>
            {(user.custom_nickname || user.username)?.charAt(0)?.toUpperCase()}
          </div>
      }
      <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-fc-channel ${STATUS_COLOR[user.user_status ?? user.status] ?? 'bg-gray-500'}`} />
    </div>
  )
}

// ── Context Menu ──────────────────────────────────────────────────────────────
function FriendMenu({ friend, onClose, onAction }: { friend: any; onClose: () => void; onAction: (a: string, f: any) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  const item = (icon: React.ReactNode, label: string, action: string, danger = false) => (
    <button onClick={() => { onAction(action, friend); onClose() }}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded transition text-left
        ${danger ? 'text-red-400 hover:bg-red-500/10' : 'text-fc-text hover:bg-fc-hover'}`}>
      {icon}{label}
    </button>
  )
  return (
    <div ref={ref} className="absolute right-0 top-0 z-50 w-52 bg-fc-bg border border-fc-hover rounded-xl shadow-2xl py-1 overflow-hidden">
      {item(<MessageCircle size={15}/>, 'Message privé', 'dm')}
      {item(<Phone size={15}/>, 'Appel vocal', 'call-voice')}
      {item(<VideoIcon size={15}/>, 'Appel vidéo', 'call-video')}
      <div className="h-px bg-fc-hover my-1" />
      {item(<Edit3 size={15}/>, 'Modifier le surnom', 'nickname')}
      {item(<StickyNote size={15}/>, 'Ajouter une note', 'note')}
      {item(<Star size={15}/>, 'Ajouter aux favoris', 'favorite')}
      {friend.notify_online
        ? item(<BellOff size={15}/>, 'Désactiver notif connexion', 'notify-off')
        : item(<Bell size={15}/>, 'Notifier à la connexion', 'notify-on')}
      <div className="h-px bg-fc-hover my-1" />
      {item(<UserMinus size={15}/>, 'Retirer des amis', 'remove', true)}
      {item(<Ban size={15}/>, 'Bloquer', 'block', true)}
    </div>
  )
}

// ── Modale : Surnom ───────────────────────────────────────────────────────────
function NicknameModal({ friend, onClose }: { friend: any; onClose: () => void }) {
  const [val, setVal] = useState(friend.custom_nickname ?? '')
  const qc = useQueryClient()
  const save = useMutation({
    mutationFn: () => api.put(`/friends/${friend.friend_id}/nickname`, { nickname: val }),
    onSuccess: () => { toast.success('Surnom mis à jour'); qc.invalidateQueries({ queryKey: ['friends-v2'] }); onClose() },
  })
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-fc-channel rounded-2xl p-6 w-80 shadow-2xl">
        <h3 className="font-bold text-white mb-1">Surnom pour {friend.username}</h3>
        <p className="text-xs text-fc-muted mb-4">Visible uniquement par toi</p>
        <input value={val} onChange={e => setVal(e.target.value)}
          placeholder={friend.username} maxLength={64}
          className="w-full px-3 py-2 bg-fc-input rounded-lg text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm mb-4" />
        <div className="flex gap-2">
          <button onClick={() => save.mutate()} disabled={save.isPending}
            className="flex-1 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition">
            Enregistrer
          </button>
          <button onClick={onClose} className="flex-1 py-2 bg-fc-hover text-fc-muted rounded-lg text-sm transition">Annuler</button>
        </div>
      </div>
    </div>
  )
}

// ── Modale : Note ─────────────────────────────────────────────────────────────
function NoteModal({ friend, onClose }: { friend: any; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ['friend-note', friend.friend_id],
    queryFn: () => api.get(`/friends/${friend.friend_id}/note`).then(r => r.data),
  })
  const [val, setVal] = useState('')
  useEffect(() => { if (data?.note) setVal(data.note) }, [data])
  const qc = useQueryClient()
  const save = useMutation({
    mutationFn: () => api.put(`/friends/${friend.friend_id}/note`, { note: val }),
    onSuccess: () => { toast.success('Note sauvegardée'); qc.invalidateQueries({ queryKey: ['friend-note', friend.friend_id] }); onClose() },
  })
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-fc-channel rounded-2xl p-6 w-96 shadow-2xl">
        <h3 className="font-bold text-white mb-1">Note sur {friend.custom_nickname || friend.username}</h3>
        <p className="text-xs text-fc-muted mb-4">Privée — visible uniquement par toi</p>
        <textarea value={val} onChange={e => setVal(e.target.value)} rows={6} maxLength={2000}
          placeholder="Ajoute une note sur cet ami..."
          className="w-full px-3 py-2 bg-fc-input rounded-lg text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm resize-none mb-4" />
        <div className="text-xs text-fc-muted mb-3 text-right">{val.length}/2000</div>
        <div className="flex gap-2">
          <button onClick={() => save.mutate()} disabled={save.isPending}
            className="flex-1 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition">
            Sauvegarder
          </button>
          <button onClick={onClose} className="flex-1 py-2 bg-fc-hover text-fc-muted rounded-lg text-sm transition">Annuler</button>
        </div>
      </div>
    </div>
  )
}

// ── Modale : Ajouter un ami ───────────────────────────────────────────────────
function AddFriendModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'name' | 'link'>('name')
  const [input, setInput] = useState('')
  const [msg, setMsg] = useState('')
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const qc = useQueryClient()

  const sendByName = useMutation({
    mutationFn: () => api.post('/friends/by-name', { name: input.trim(), message: msg.trim() || undefined }),
    onSuccess: () => { toast.success('Demande envoyée !'); qc.invalidateQueries({ queryKey: ['friends-v2'] }); setInput(''); setMsg('') },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })
  const sendById = useMutation({
    mutationFn: () => api.post('/friends', { user_id: input.trim() }),
    onSuccess: () => { toast.success('Demande envoyée !'); qc.invalidateQueries({ queryKey: ['friends-v2'] }); setInput('') },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })
  const createLink = useMutation({
    mutationFn: () => api.post('/friends/invite').then(r => r.data),
    onSuccess: d => setInviteUrl(d.url),
  })

  const isUuid = /^[0-9a-f-]{36}$/.test(input.trim())

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-fc-channel rounded-2xl w-[480px] shadow-2xl overflow-hidden">
        <div className="p-6 border-b border-fc-hover flex items-center justify-between">
          <h2 className="font-bold text-white text-lg">Ajouter un ami</h2>
          <button onClick={onClose} className="text-fc-muted hover:text-white transition"><X size={20}/></button>
        </div>
        <div className="flex border-b border-fc-hover">
          {(['name', 'link'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-3 text-sm font-medium transition ${tab === t ? 'text-white border-b-2 border-fc-accent' : 'text-fc-muted hover:text-white'}`}>
              {t === 'name' ? 'Par nom d\'utilisateur' : 'Lien d\'invitation'}
            </button>
          ))}
        </div>
        <div className="p-6">
          {tab === 'name' && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2 block">
                  Nom d'utilisateur ou ID
                </label>
                <input value={input} onChange={e => setInput(e.target.value)}
                  placeholder="utilisateur#1234 ou UUID"
                  className="w-full px-3 py-2.5 bg-fc-input rounded-lg text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2 block">
                  Message (optionnel)
                </label>
                <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={2} maxLength={256}
                  placeholder="Salut, on se connaît de..."
                  className="w-full px-3 py-2 bg-fc-input rounded-lg text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm resize-none" />
              </div>
              <button
                onClick={() => isUuid ? sendById.mutate() : sendByName.mutate()}
                disabled={!input.trim() || sendByName.isPending || sendById.isPending}
                className="w-full py-2.5 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition disabled:opacity-50">
                Envoyer la demande
              </button>
            </div>
          )}
          {tab === 'link' && (
            <div className="space-y-4">
              <p className="text-sm text-fc-muted">
                Génère un lien unique valable 7 jours. Quiconque clique sur ce lien devient ton ami directement.
              </p>
              {inviteUrl ? (
                <div className="flex gap-2">
                  <input readOnly value={inviteUrl}
                    className="flex-1 px-3 py-2 bg-fc-input rounded-lg text-white text-sm outline-none" />
                  <button onClick={() => { navigator.clipboard.writeText(inviteUrl); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-1.5
                      ${copied ? 'bg-green-600 text-white' : 'bg-fc-accent hover:bg-indigo-500 text-white'}`}>
                    {copied ? <Check size={14}/> : <Copy size={14}/>}
                    {copied ? 'Copié !' : 'Copier'}
                  </button>
                </div>
              ) : (
                <button onClick={() => createLink.mutate()} disabled={createLink.isPending}
                  className="w-full py-2.5 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition disabled:opacity-50 flex items-center justify-center gap-2">
                  <Link size={16}/>
                  {createLink.isPending ? 'Génération...' : 'Générer un lien d\'invitation'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Carte ami ─────────────────────────────────────────────────────────────────
function FriendCard({ friend, onAction }: { friend: any; onAction: (a: string, f: any) => void }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const displayName = friend.custom_nickname || friend.username
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-fc-hover/50 transition group relative">
      <Avatar user={friend} size={10} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-white text-sm truncate">{displayName}</span>
          {friend.custom_nickname && (
            <span className="text-xs text-fc-muted truncate">({friend.username}#{friend.discriminator})</span>
          )}
        </div>
        <div className="text-xs text-fc-muted truncate">
          {friend.activity_name
            ? <span className="text-indigo-400">🎮 {friend.activity_name}</span>
            : friend.custom_status
            ? <span className="italic">"{friend.custom_status}"</span>
            : STATUS_LABEL[friend.user_status] ?? 'Hors ligne'
          }
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
        <button onClick={() => onAction('dm', friend)}
          title="Message" className="p-2 rounded-full bg-fc-channel hover:bg-fc-input text-fc-muted hover:text-white transition">
          <MessageCircle size={16}/>
        </button>
        <button onClick={() => onAction('call-voice', friend)}
          title="Appel vocal" className="p-2 rounded-full bg-fc-channel hover:bg-fc-input text-fc-muted hover:text-white transition">
          <Phone size={16}/>
        </button>
        <div className="relative">
          <button onClick={() => setMenuOpen(v => !v)}
            className="p-2 rounded-full bg-fc-channel hover:bg-fc-input text-fc-muted hover:text-white transition">
            <MoreVertical size={16}/>
          </button>
          {menuOpen && <FriendMenu friend={friend} onClose={() => setMenuOpen(false)} onAction={onAction} />}
        </div>
      </div>
    </div>
  )
}

// ── Groupes d'amis (panel latéral) ───────────────────────────────────────────
function GroupsPanel({ friends, onFilterGroup }: { friends: any[]; onFilterGroup: (ids: string[] | null) => void }) {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState(true)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')

  const { data: groups = [] } = useQuery({
    queryKey: ['friend-groups'],
    queryFn: () => api.get('/friends/groups').then(r => r.data),
  })

  const createGroup = useMutation({
    mutationFn: () => api.post('/friends/groups', { name: newName }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['friend-groups'] }); setNewName(''); setAdding(false) },
  })

  const deleteGroup = useMutation({
    mutationFn: (id: string) => api.delete(`/friends/groups/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friend-groups'] }),
  })

  return (
    <div className="w-52 flex-shrink-0 border-r border-fc-hover p-3 overflow-y-auto">
      <button onClick={() => onFilterGroup(null)} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-fc-muted hover:bg-fc-hover hover:text-white text-sm transition mb-1">
        <Users size={14}/> Tous les amis
      </button>
      <div className="flex items-center justify-between px-3 py-1.5 mt-2">
        <span className="text-xs font-semibold text-fc-muted uppercase tracking-wide">Groupes</span>
        <button onClick={() => setAdding(v => !v)} className="text-fc-muted hover:text-white transition">
          <UserPlus size={13}/>
        </button>
      </div>
      {adding && (
        <div className="px-2 mb-2">
          <input value={newName} onChange={e => setNewName(e.target.value)}
            placeholder="Nom du groupe" maxLength={64}
            onKeyDown={e => e.key === 'Enter' && newName && createGroup.mutate()}
            className="w-full px-2 py-1.5 bg-fc-input rounded text-white text-xs outline-none" />
        </div>
      )}
      {groups.map((g: any) => (
        <button key={g.id} onClick={() => onFilterGroup(g.member_ids)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-fc-muted hover:bg-fc-hover hover:text-white text-sm transition group">
          <span className="text-base">📁</span>
          <span className="flex-1 truncate">{g.name}</span>
          <span className="text-xs">{g.member_ids?.length ?? 0}</span>
        </button>
      ))}
    </div>
  )
}

// ── Historique d'appels ───────────────────────────────────────────────────────
function CallHistory() {
  const { data: calls = [] } = useQuery({
    queryKey: ['call-history'],
    queryFn: () => api.get('/friends/calls').then(r => r.data),
  })
  const nav = useNavigate()
  if (!calls.length) return <p className="text-fc-muted text-sm p-4">Aucun appel récent.</p>
  return (
    <div className="space-y-1 p-2">
      {calls.map((c: any) => {
        const Icon = c.status === 'missed' ? PhoneMissed
          : c.direction === 'incoming' ? PhoneIncoming : PhoneCall
        const color = c.status === 'missed' ? 'text-red-400' : 'text-green-400'
        return (
          <div key={c.id} className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-fc-hover/50 transition">
            <div className="w-10 h-10 rounded-full bg-fc-accent flex items-center justify-center text-white font-bold">
              {c.other_user.username?.charAt(0)?.toUpperCase()}
            </div>
            <div className="flex-1">
              <div className="font-medium text-white text-sm">{c.other_user.username}</div>
              <div className={`text-xs flex items-center gap-1 ${color}`}>
                <Icon size={11}/>
                {c.call_type === 'video' ? 'Appel vidéo' : 'Appel vocal'} · {formatDistanceToNow(new Date(c.started_at), { locale: fr, addSuffix: true })}
                {c.duration_s && ` · ${Math.floor(c.duration_s / 60)}m${c.duration_s % 60}s`}
              </div>
            </div>
            <button onClick={() => nav(`/dms/${c.dm_id}`)} title="Rappeler"
              className="p-2 rounded-full bg-fc-channel hover:bg-green-600/20 text-fc-muted hover:text-green-400 transition">
              <Phone size={14}/>
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ── Page principale ───────────────────────────────────────────────────────────
export default function FriendsPage() {
  const [tab, setTab] = useState<Tab>('online')
  const [search, setSearch] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [nicknameFor, setNicknameFor] = useState<any>(null)
  const [noteFor, setNoteFor] = useState<any>(null)
  const [groupFilter, setGroupFilter] = useState<string[] | null>(null)
  const qc = useQueryClient()
  const nav = useNavigate()

  const { data: friendsData } = useQuery({
    queryKey: ['friends-v2', tab, search],
    queryFn: () => api.get('/friends/v2', { params: {
      filter: tab === 'online' ? 'online' : tab === 'pending' ? 'pending' : tab === 'blocked' ? 'blocked' : 'all',
      q: search,
    }}).then(r => r.data),
    refetchInterval: 30_000,
  })

  const { data: suggestions = [] } = useQuery({
    queryKey: ['friend-suggestions'],
    queryFn: () => api.get('/friends/suggestions').then(r => r.data),
    enabled: tab === 'suggestions',
  })

  const friends: any[] = friendsData?.friends ?? []
  const counts = friendsData?.counts ?? {}

  const filtered = groupFilter
    ? friends.filter(f => groupFilter.includes(f.friend_id))
    : friends

  const accept = useMutation({
    mutationFn: (id: string) => api.post(`/friends/${id}/accept`),
    onSuccess: () => { toast.success('Ami ajouté !'); qc.invalidateQueries({ queryKey: ['friends-v2'] }) },
  })
  const cancel = useMutation({
    mutationFn: (id: string) => api.delete(`/friends/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends-v2'] }),
  })
  const decline = useMutation({
    mutationFn: (id: string) => api.post(`/friends/${id}/decline`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends-v2'] }),
  })
  const sendRequest = useMutation({
    mutationFn: (uid: string) => api.post('/friends', { user_id: uid }),
    onSuccess: () => { toast.success('Demande envoyée !'); qc.invalidateQueries({ queryKey: ['friend-suggestions'] }) },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const handleAction = async (action: string, friend: any) => {
    switch (action) {
      case 'dm': {
        const { data } = await api.post(`/dms/${friend.friend_id}`)
        nav(`/dms/${data.dm_id}`)
        break
      }
      case 'call-voice':
      case 'call-video': {
        const { data } = await api.post(`/dms/${friend.friend_id}`)
        nav(`/dms/${data.dm_id}?call=${action === 'call-video' ? 'video' : 'voice'}`)
        break
      }
      case 'nickname': setNicknameFor(friend); break
      case 'note':     setNoteFor(friend); break
      case 'favorite':
        await api.post(`/users/${friend.friend_id}/favorite`)
        toast.success('Ajouté aux favoris')
        break
      case 'notify-on':
        await api.put(`/friends/${friend.friend_id}/notify`, { enabled: true })
        toast.success('Tu seras notifié quand il se connecte')
        qc.invalidateQueries({ queryKey: ['friends-v2'] })
        break
      case 'notify-off':
        await api.put(`/friends/${friend.friend_id}/notify`, { enabled: false })
        qc.invalidateQueries({ queryKey: ['friends-v2'] })
        break
      case 'remove':
        if (confirm(`Retirer ${friend.username} de tes amis ?`)) {
          await api.delete(`/friends/${friend.friend_id}`)
          toast.success('Ami retiré')
          qc.invalidateQueries({ queryKey: ['friends-v2'] })
        }
        break
      case 'block':
        if (confirm(`Bloquer ${friend.username} ?`)) {
          await api.post(`/users/${friend.friend_id}/block`)
          toast.success('Utilisateur bloqué')
          qc.invalidateQueries({ queryKey: ['friends-v2'] })
        }
        break
    }
  }

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'online',      label: 'En ligne',    count: counts.online },
    { id: 'all',         label: 'Tous',        count: counts.all },
    { id: 'pending',     label: 'En attente',  count: counts.pending_received },
    { id: 'blocked',     label: 'Bloqués' },
    { id: 'suggestions', label: 'Suggestions' },
    { id: 'calls',       label: 'Appels' },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-fc-bg shadow-sm flex-shrink-0 flex-wrap">
        <span className="font-semibold text-white flex items-center gap-2">
          <Users size={18} className="text-fc-accent"/> Amis
        </span>
        <div className="flex gap-0.5 flex-wrap">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-3 py-1 rounded-lg text-sm font-medium transition flex items-center gap-1
                ${tab === t.id ? 'bg-fc-hover text-white' : 'text-fc-muted hover:text-white hover:bg-fc-hover/50'}`}>
              {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span className="bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">{t.count}</span>
              )}
            </button>
          ))}
        </div>
        <button onClick={() => setShowAddModal(true)}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition">
          <UserPlus size={15}/> Ajouter
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Groupes sidebar */}
        {(tab === 'all' || tab === 'online') && (
          <GroupsPanel friends={friends} onFilterGroup={setGroupFilter} />
        )}

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Barre de recherche */}
          {tab !== 'calls' && tab !== 'suggestions' && (
            <div className="px-4 pt-3 pb-1 flex-shrink-0">
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fc-muted"/>
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Rechercher un ami..."
                  className="w-full pl-9 pr-3 py-2 bg-fc-input rounded-lg text-white outline-none text-sm" />
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto py-2">
            {/* Historique appels */}
            {tab === 'calls' && <CallHistory />}

            {/* Suggestions */}
            {tab === 'suggestions' && (
              <div className="px-2">
                <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide px-4 py-2">
                  Personnes que tu pourrais connaître · {suggestions.length}
                </div>
                {suggestions.length === 0 && (
                  <p className="text-fc-muted text-sm px-4">Invite des amis à rejoindre ForgeChat pour voir des suggestions ici.</p>
                )}
                {suggestions.map((s: any) => (
                  <div key={s.id} className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-fc-hover/50 transition">
                    <div className="w-10 h-10 rounded-full bg-fc-accent flex items-center justify-center text-white font-bold flex-shrink-0">
                      {s.username?.charAt(0)?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-white text-sm">{s.username}#{s.discriminator}</div>
                      <div className="text-xs text-fc-muted">
                        {s.mutual_friends > 0 && `${s.mutual_friends} ami(s) en commun`}
                        {s.mutual_friends > 0 && s.mutual_servers > 0 && ' · '}
                        {s.mutual_servers > 0 && `${s.mutual_servers} serveur(s) en commun`}
                      </div>
                    </div>
                    <button onClick={() => sendRequest.mutate(s.id)}
                      disabled={sendRequest.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-xs font-medium transition disabled:opacity-50">
                      <UserPlus size={12}/> Ajouter
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* En attente */}
            {tab === 'pending' && (
              <div className="px-2">
                {/* Reçues */}
                {filtered.filter(f => f.direction === 'received').length > 0 && (
                  <>
                    <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide px-4 py-2">
                      Demandes reçues · {filtered.filter(f => f.direction === 'received').length}
                    </div>
                    {filtered.filter(f => f.direction === 'received').map(f => (
                      <div key={f.id} className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-fc-hover/50 transition">
                        <Avatar user={{ username: f.username, avatar: f.avatar, user_status: f.user_status }} />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-white text-sm">{f.username}#{f.discriminator}</div>
                          {f.message && <p className="text-xs text-fc-muted italic truncate">"{f.message}"</p>}
                          <div className="text-xs text-fc-muted">
                            {f.requested_at && formatDistanceToNow(new Date(f.requested_at), { locale: fr, addSuffix: true })}
                          </div>
                        </div>
                        <button onClick={() => accept.mutate(f.id)}
                          className="p-2 bg-green-600/20 hover:bg-green-600/40 text-green-400 rounded-full transition" title="Accepter">
                          <Check size={16}/>
                        </button>
                        <button onClick={() => decline.mutate(f.id)}
                          className="p-2 bg-red-500/20 hover:bg-red-500/40 text-red-400 rounded-full transition" title="Refuser">
                          <X size={16}/>
                        </button>
                      </div>
                    ))}
                  </>
                )}
                {/* Envoyées */}
                {filtered.filter(f => f.direction === 'sent').length > 0 && (
                  <>
                    <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide px-4 py-2 mt-2">
                      Demandes envoyées · {filtered.filter(f => f.direction === 'sent').length}
                    </div>
                    {filtered.filter(f => f.direction === 'sent').map(f => (
                      <div key={f.id} className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-fc-hover/50 transition">
                        <Avatar user={{ username: f.username, avatar: f.avatar, user_status: f.user_status }} />
                        <div className="flex-1">
                          <div className="font-medium text-white text-sm">{f.username}#{f.discriminator}</div>
                          <div className="text-xs text-fc-muted">En attente de réponse...</div>
                        </div>
                        <button onClick={() => cancel.mutate(f.id)}
                          className="px-3 py-1.5 bg-fc-hover hover:bg-red-500/20 text-fc-muted hover:text-red-400 rounded-lg text-xs transition">
                          Annuler
                        </button>
                      </div>
                    ))}
                  </>
                )}
                {filtered.length === 0 && (
                  <p className="text-fc-muted text-sm px-4 py-4">Aucune demande en attente.</p>
                )}
              </div>
            )}

            {/* Bloqués */}
            {tab === 'blocked' && (
              <div className="px-2">
                <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide px-4 py-2">
                  Bloqués · {filtered.length}
                </div>
                {filtered.map(f => (
                  <div key={f.id} className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-fc-hover/50 transition">
                    <div className="w-10 h-10 rounded-full bg-fc-muted/30 flex items-center justify-center text-fc-muted font-bold">
                      {f.username?.charAt(0)?.toUpperCase()}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-white text-sm">{f.username}</div>
                    </div>
                    <button onClick={async () => { await api.delete(`/users/${f.friend_id}/block`); toast.success('Débloqué'); qc.invalidateQueries({ queryKey: ['friends-v2'] }) }}
                      className="px-3 py-1.5 bg-fc-hover hover:bg-fc-input text-fc-muted hover:text-white rounded-lg text-xs transition">
                      Débloquer
                    </button>
                  </div>
                ))}
                {filtered.length === 0 && <p className="text-fc-muted text-sm px-4">Aucun utilisateur bloqué.</p>}
              </div>
            )}

            {/* En ligne / Tous */}
            {(tab === 'online' || tab === 'all') && (
              <div className="px-2">
                {filtered.length > 0 && (
                  <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide px-4 py-2">
                    {tab === 'online' ? 'En ligne' : 'Tous les amis'} — {filtered.length}
                  </div>
                )}
                {filtered.map(f => (
                  <FriendCard key={f.id} friend={f} onAction={handleAction} />
                ))}
                {filtered.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <Users size={48} className="text-fc-muted/30"/>
                    <p className="text-fc-muted text-sm">
                      {tab === 'online' ? 'Aucun ami en ligne' : 'Aucun ami pour le moment'}
                    </p>
                    <button onClick={() => setShowAddModal(true)}
                      className="flex items-center gap-1.5 px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-sm transition">
                      <UserPlus size={15}/> Ajouter un ami
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {showAddModal && <AddFriendModal onClose={() => setShowAddModal(false)} />}
      {nicknameFor && <NicknameModal friend={nicknameFor} onClose={() => setNicknameFor(null)} />}
      {noteFor && <NoteModal friend={noteFor} onClose={() => setNoteFor(null)} />}
    </div>
  )
}
```

---

## Vérification finale (cargo check + tsc)

```bash
cd server && cargo check 2>&1 | grep -E "error|warning" | head -20
cd client && npx tsc --noEmit 2>&1 | head -30
```
