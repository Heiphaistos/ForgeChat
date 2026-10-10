use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Extension, Json,
};
use std::collections::HashMap;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::{password_reset::over_limit, servers::require_member},
    middleware::auth::Claims,
    handlers::profile_custom::ProfileCustom,
    models::user::{UpdateProfileRequest, UserPublic},
    state::AppState,
};

pub async fn get_me(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<UserPublic>> {
    let user = sqlx::query_as::<_, crate::models::user::User>(
        "SELECT * FROM users WHERE id=$1"
    )
    .bind(claims.sub)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Utilisateur introuvable".into()))?;

    Ok(Json(user.into_self_public()))
}

pub async fn get_user(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<UserPublic>> {
    let user = sqlx::query_as::<_, crate::models::user::User>(
        "SELECT * FROM users WHERE id=$1"
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Utilisateur introuvable".into()))?;

    let mut public: UserPublic = if user_id == claims.sub { user.into_self_public() } else { user.into() };

    // `activity_visibility` (user_settings du TARGET, everyone/friends/nobody) était
    // stocké et relu correctement dans les Réglages mais jamais consulté ici -- l'activité
    // ("en train de jouer à...") était toujours visible par n'importe qui peu importe le
    // réglage, un pur placebo côté UI.
    if user_id != claims.sub {
        let visibility: Option<String> = sqlx::query_scalar(
            "SELECT activity_visibility FROM user_settings WHERE user_id=$1"
        )
        .bind(user_id)
        .fetch_optional(&state.db)
        .await?;

        let show_activity = match visibility.as_deref() {
            Some("nobody") => false,
            Some("friends") => sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS(SELECT 1 FROM friendships WHERE status='accepted' AND
                 ((user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)))"
            )
            .bind(claims.sub)
            .bind(user_id)
            .fetch_one(&state.db)
            .await
            .unwrap_or(false),
            _ => true, // "everyone" ou pas de préférence enregistrée
        };

        if !show_activity {
            public.activity_type = None;
            public.activity_name = None;
            public.activity_detail = None;
        }

        // `birthday` (date exacte) et `totp_enabled` n'ont de sens que pour SA PROPRE
        // fiche (ProfileSection.tsx pour éditer, SecuritySection.tsx pour l'état 2FA) --
        // aucun code client ne les lit jamais depuis le profil d'un AUTRE utilisateur,
        // pourtant `UserPublic` (partagé entre get_me et get_user) les incluait sans
        // distinction : n'importe quel utilisateur authentifié pouvait récupérer la date
        // de naissance exacte de n'importe qui via GET /users/:id, sans même être ami.
        public = public.for_others();
    }

    Ok(Json(public))
}

pub async fn update_me(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<UpdateProfileRequest>,
) -> Result<Json<UserPublic>> {
    if let Some(ref username) = body.username {
        if username.len() < 2 || username.len() > 32 {
            return Err(AppError::BadRequest("Nom 2-32 chars".into()));
        }
        // Même règle que l'inscription (auth.rs::register) -- jamais reportée ici,
        // donc modifier son profil permettait de contourner entièrement la
        // validation de caractères imposée à la création du compte (espaces,
        // emoji, HTML/scripts, caractères de contrôle, tout passait).
        if !username.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-') {
            return Err(AppError::BadRequest("Le nom d'utilisateur ne peut contenir que des lettres, chiffres, _ et -".into()));
        }
    }

    // Valider activity_type si fourni
    if let Some(ref at) = body.activity_type {
        let valid = ["playing", "listening", "watching", "streaming", "competing", ""];
        if !valid.contains(&at.as_str()) {
            return Err(AppError::BadRequest("activity_type invalide".into()));
        }
    }
    // Colonnes VARCHAR(100) : une saisie plus longue (« J'écoute… ») donnait une erreur 500.
    if [&body.activity_name, &body.activity_detail].iter().any(|v| v.as_deref().is_some_and(|s| s.chars().count() > 100)) {
        return Err(AppError::BadRequest("Activité : 100 caractères max".into()));
    }

    if let Some(ref p) = body.pronouns {
        if p.len() > 30 {
            return Err(AppError::BadRequest("Pronoms : 30 caractères max".into()));
        }
    }

    // `bio`/`custom_status` sont des colonnes TEXT non bornées en DB -- seuls les
    // attributs `maxLength` HTML côté client (190 / 128, ProfileSection.tsx /
    // CustomStatusModal.tsx) limitaient la taille, trivialement contournables par
    // un appel direct à l'API. Confirmé en direct : PATCH avec un bio de 50000
    // caractères était accepté et stocké tel quel avant ce fix.
    if let Some(ref banner) = body.banner {
        if !crate::models::profile_style::valid_banner_ref(banner) {
            return Err(AppError::BadRequest("Bannière : envoyez l'image via /users/me/banner".into()));
        }
    }
    if let Some(ref bio) = body.bio {
        if bio.chars().count() > 190 {
            return Err(AppError::BadRequest("Bio : 190 caractères max".into()));
        }
    }
    // P1-3 — statut CHOISI ; le statut en direct est recalculé ensuite. Aucune
    // validation avant : n'importe quelle chaîne était stockée telle quelle.
    if let Some(ref st) = body.status {
        if !crate::handlers::presence::CHOOSABLE.contains(&st.as_str()) {
            return Err(AppError::BadRequest("Statut invalide (online|idle|dnd|invisible)".into()));
        }
    }
    let status_changed = body.status.is_some();
    if let Some(ref cs) = body.custom_status {
        if cs.chars().count() > 128 {
            return Err(AppError::BadRequest("Statut personnalisé : 128 caractères max".into()));
        }
    }

    body.validate_cosmetics().map_err(|e| AppError::BadRequest(e.into()))?;
    let custom = ProfileCustom::from_request(&body)?;
    if over_limit(&state, &format!("profile_patch:{}", claims.sub), 60, 600).await {
        return Err(AppError::TooManyRequests);
    }

    let (birthday_val, birthday_clear): (Option<chrono::NaiveDate>, bool) = match &body.birthday {
        None => (None, false),
        Some(serde_json::Value::Null) => (None, true),
        Some(serde_json::Value::String(s)) => {
            let d = chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
                .map_err(|_| crate::error::AppError::BadRequest("Format date invalide (YYYY-MM-DD)".into()))?;
            (Some(d), false)
        }
        _ => return Err(crate::error::AppError::BadRequest("birthday invalide".into())),
    };

    let user = sqlx::query_as::<_, crate::models::user::User>(
        "UPDATE users SET
            username = COALESCE($2, username),
            bio = COALESCE($3, bio),
            custom_status = CASE WHEN $4::TEXT IS NOT NULL THEN NULLIF($4, '') ELSE custom_status END,
            preferred_status = COALESCE($5, preferred_status),
            banner = CASE WHEN $6::TEXT IS NOT NULL THEN $6 ELSE banner END,
            activity_type = CASE WHEN $7::VARCHAR IS NOT NULL THEN NULLIF($7, '') ELSE activity_type END,
            activity_name = CASE WHEN $7::VARCHAR IS NOT NULL THEN NULLIF($8, '') ELSE activity_name END,
            activity_detail = CASE WHEN $7::VARCHAR IS NOT NULL THEN NULLIF($9, '') ELSE activity_detail END,
            birthday = CASE WHEN $11 THEN NULL WHEN $10::DATE IS NOT NULL THEN $10 ELSE birthday END,
            birthday_has_year = CASE WHEN $10::DATE IS NOT NULL THEN TRUE ELSE birthday_has_year END,
            pronouns = COALESCE($12, pronouns),
            avatar_decoration = CASE WHEN $13::VARCHAR IS NOT NULL THEN NULLIF($13, '') ELSE avatar_decoration END,
            profile_color_primary = CASE WHEN $14::INT IS NULL THEN profile_color_primary WHEN $14 < 0 THEN NULL ELSE $14 END,
            profile_color_accent = CASE WHEN $15::INT IS NULL THEN profile_color_accent WHEN $15 < 0 THEN NULL ELSE $15 END,
            profile_effect = CASE WHEN $16::VARCHAR IS NOT NULL THEN NULLIF($16, '') ELSE profile_effect END,
            display_name = CASE WHEN $17 THEN $18 ELSE display_name END,
            name_style = CASE WHEN $19 THEN $20 ELSE name_style END,
            profile_tag = CASE WHEN $21 THEN $22 ELSE profile_tag END,
            profile_links = CASE WHEN $23 THEN $24 ELSE profile_links END,
            custom_status_expires_at = CASE WHEN $4::TEXT IS NOT NULL THEN $25 ELSE custom_status_expires_at END,
            updated_at = NOW()
         WHERE id=$1 RETURNING *"
    )
    .bind(claims.sub)
    .bind(body.username)
    .bind(body.bio)
    .bind(body.custom_status)
    .bind(body.status)
    .bind(body.banner.as_deref())
    .bind(body.activity_type.as_deref())
    .bind(body.activity_name.as_deref())
    .bind(body.activity_detail.as_deref())
    .bind(birthday_val)
    .bind(birthday_clear)
    .bind(body.pronouns.as_deref())
    .bind(body.avatar_decoration.as_deref())
    .bind(body.profile_color_primary)
    .bind(body.profile_color_accent)
    .bind(body.profile_effect.as_deref())
    .bind(custom.display_name.is_some())
    .bind(custom.display_name.flatten())
    .bind(custom.name_style.is_some())
    .bind(custom.name_style.flatten())
    .bind(custom.profile_tag.is_some())
    .bind(custom.profile_tag.flatten())
    .bind(custom.profile_links.is_some())
    .bind(custom.profile_links.flatten())
    .bind(custom.status_expires_at)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        if let sqlx::Error::Database(ref db_err) = e {
            if db_err.code().as_deref() == Some("23505") {
                return AppError::Conflict("Ce nom d'utilisateur est déjà pris".into());
            }
        }
        AppError::from(e)
    })?;

    // Broadcast mise à jour profil à tous les membres des serveurs communs (1 query).
    // `activity_visibility` (everyone/friends/nobody) ne servait à rien tant que ce
    // broadcast temps réel envoyait toujours l'activité complète à tout le monde --
    // un filtre posé uniquement sur GET /users/:id (voir get_user) aurait été
    // trivialement contourné par ce canal WS. Construit donc 2 versions de l'event
    // et choisit laquelle envoyer par destinataire.
    let activity_visibility: String = sqlx::query_scalar(
        "SELECT activity_visibility FROM user_settings WHERE user_id=$1"
    )
    .bind(claims.sub)
    .fetch_optional(&state.db)
    .await?
    .unwrap_or_else(|| "everyone".to_string());

    if status_changed {
        crate::handlers::presence::refresh(&state, claims.sub).await;
    }

    // Date de naissance et 2FA : jamais diffusées aux autres (voir get_user).
    let public_full = UserPublic::from(user.clone()).for_others();
    let mut public_no_activity = public_full.clone();
    public_no_activity.activity_type = None;
    public_no_activity.activity_name = None;
    public_no_activity.activity_detail = None;

    let event_full = serde_json::json!({ "type": "USER_UPDATE", "user": public_full }).to_string();
    let event_no_activity = serde_json::json!({ "type": "USER_UPDATE", "user": public_no_activity }).to_string();

    // Soi-même voit toujours sa propre fiche complète (autres onglets/appareils)
    state.broadcast_to_user(claims.sub, serde_json::json!({ "type": "USER_UPDATE", "user": UserPublic::from(user.clone()) }).to_string()).await;

    let visible_to: Vec<Uuid> = sqlx::query_scalar(
        "SELECT DISTINCT sm2.user_id
         FROM server_members sm1
         JOIN server_members sm2 ON sm2.server_id = sm1.server_id
         WHERE sm1.user_id = $1 AND sm2.user_id != $1"
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let friend_ids: std::collections::HashSet<Uuid> = if activity_visibility == "friends" {
        sqlx::query_scalar::<_, Uuid>(
            "SELECT CASE WHEN user_id=$1 THEN friend_id ELSE user_id END
             FROM friendships WHERE status='accepted' AND (user_id=$1 OR friend_id=$1)"
        )
        .bind(claims.sub)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default()
        .into_iter()
        .collect()
    } else {
        Default::default()
    };

    {
        let clients = state.clients.read().await;
        for uid in visible_to {
            if let Some(tx) = clients.get(&uid) {
                let ev = match activity_visibility.as_str() {
                    "nobody" => &event_no_activity,
                    "friends" => if friend_ids.contains(&uid) { &event_full } else { &event_no_activity },
                    _ => &event_full,
                };
                let _ = tx.send(ev.clone());
            }
        }
    }

    Ok(Json(user.into_self_public()))
}

pub async fn delete_account(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>> {
    // Rate limit : 5 tentatives / 15min par compte -- même pattern que change_password
    // (auth.rs), qui protège la même opération "vérifier le mot de passe courant" mais
    // n'existait pas ici. Scope par claims.sub plutôt que par IP : cet endpoint ne peut
    // de toute façon cibler que le compte du token authentifié (pas de risque cross-
    // compte), donc bloquer par utilisateur suffit et reste valable même si l'attaquant
    // change d'IP.
    {
        use redis::AsyncCommands;
        let key = format!("delacc_attempts:{}", claims.sub);
        let mut redis = state.redis.lock().await;
        let count: Option<i64> = redis.get(&key).await.unwrap_or(None);
        let count = count.unwrap_or(0);
        if count >= 5 {
            return Err(AppError::TooManyRequests);
        }
        let _: () = redis.incr(&key, 1).await.unwrap_or(());
        if count == 0 {
            let _: () = redis.expire(&key, 900).await.unwrap_or(());
        }
    }

    // Exiger la confirmation du mot de passe pour éviter la suppression accidentelle/CSRF
    let password = body["password"]
        .as_str()
        .ok_or_else(|| AppError::BadRequest("Mot de passe requis pour confirmer la suppression".into()))?;

    let pw_hash = sqlx::query_scalar::<_, String>(
        "SELECT password_hash FROM users WHERE id=$1"
    )
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    if !bcrypt::verify(password, &pw_hash).unwrap_or(false) {
        return Err(AppError::BadRequest("Mot de passe incorrect".into()));
    }

    // servers.owner_id REFERENCES users(id) SANS ON DELETE CASCADE (par design --
    // contrairement aux groupes DM, on ne réassigne pas silencieusement la propriété
    // d'un serveur entier à un membre au hasard). Sans ce check, DELETE FROM users
    // plus bas heurtait la contrainte FK (code Postgres 23503) et remontait en 500
    // générique "Erreur base de données" -- aucune fonctionnalité de transfert de
    // propriété n'existe (grep négatif sur servers.rs), donc un owner de serveur ne
    // pouvait JAMAIS supprimer son compte sans un message expliquant pourquoi.
    let owns_server: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM servers WHERE owner_id=$1)"
    ).bind(claims.sub).fetch_one(&state.db).await?;
    if owns_server {
        return Err(AppError::BadRequest(
            "Vous devez d'abord supprimer les serveurs dont vous êtes propriétaire.".into()
        ));
    }

    // group_dm_channels.owner_id REFERENCES users(id) ON DELETE CASCADE -- sans
    // réassignation, supprimer son propre compte efface INTÉGRALEMENT (messages compris,
    // cascade transitive) chaque groupe DM qu'on possède, pour TOUS les autres membres,
    // sans leur consentement. Même logique de transfert que leave_group_dm (membre
    // restant le plus ancien via joined_at) appliquée à chaque groupe possédé, avant le
    // DELETE FROM users -- seuls les groupes SANS aucun autre membre restent voués à la
    // cascade (comportement correct : plus personne à qui transférer).
    sqlx::query(
        "UPDATE group_dm_channels gc SET owner_id = (
            SELECT gm.user_id FROM group_dm_members gm
            WHERE gm.dm_id = gc.id AND gm.user_id != $1
            ORDER BY gm.joined_at ASC LIMIT 1
         )
         WHERE gc.owner_id = $1
           AND EXISTS(SELECT 1 FROM group_dm_members gm WHERE gm.dm_id = gc.id AND gm.user_id != $1)"
    )
    .bind(claims.sub)
    .execute(&state.db)
    .await?;

    sqlx::query("DELETE FROM users WHERE id=$1")
        .bind(claims.sub)
        .execute(&state.db)
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn search_users(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<Json<Vec<UserPublic>>> {
    let query = params.get("q").cloned().unwrap_or_default();
    if query.len() < 2 {
        return Ok(Json(vec![]));
    }

    let q_esc = query.to_lowercase().replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
    let pattern = format!("%{}%", q_esc);

    // Scope to server members when server_id is provided
    let server_id: Option<uuid::Uuid> = params.get("server_id")
        .and_then(|s| s.parse().ok());

    let users: Vec<crate::models::user::User> = if let Some(sid) = server_id {
        // Verify caller is also a member before revealing server members
        require_member(&state, claims.sub, sid).await?;
        sqlx::query_as::<_, crate::models::user::User>(
            "SELECT u.* FROM users u
             JOIN server_members sm ON sm.user_id = u.id AND sm.server_id = $3
             WHERE LOWER(u.username) LIKE $1 AND u.id != $2
             LIMIT 20"
        )
        .bind(&pattern)
        .bind(claims.sub)
        .bind(sid)
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query_as::<_, crate::models::user::User>(
            "SELECT * FROM users WHERE LOWER(username) LIKE $1 AND id != $2 LIMIT 20"
        )
        .bind(&pattern)
        .bind(claims.sub)
        .fetch_all(&state.db)
        .await?
    };

    // Fiches d'autres comptes : même masquage que get_user (date de naissance, 2FA),
    // et pas d'activité (son réglage de visibilité n'est pas évalué ici).
    Ok(Json(users.into_iter().map(|u| {
        let mut p = UserPublic::from(u).for_others();
        p.activity_type = None;
        p.activity_name = None;
        p.activity_detail = None;
        p
    }).collect()))
}

pub async fn get_login_history(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<serde_json::Value>>> {
    use sqlx::Row;

    let rows = sqlx::query(
        "SELECT id, device_info, last_seen, created_at
         FROM user_sessions
         WHERE user_id = $1
         ORDER BY last_seen DESC
         LIMIT 20"
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("{}", e)))?;

    let result = rows.iter().map(|r| serde_json::json!({
        "id": r.get::<uuid::Uuid, _>("id").to_string(),
        "device_info": r.get::<Option<String>, _>("device_info"),
        "last_seen": r.get::<chrono::DateTime<chrono::Utc>, _>("last_seen").to_rfc3339(),
        "created_at": r.get::<chrono::DateTime<chrono::Utc>, _>("created_at").to_rfc3339(),
    })).collect();

    Ok(Json(result))
}

/// GET /users/:id/profile — profil public + statut relation (optionnel auth via header)
pub async fn get_user_profile(
    State(state): State<AppState>,
    claims: Option<Extension<Claims>>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;

    let user = sqlx::query(
        "SELECT id, username, discriminator, avatar, banner, bio, status, custom_status,
                custom_status_emoji, activity_type, activity_name, activity_detail,
                is_verified, created_at, avatar_decoration, profile_color_primary,
                profile_color_accent, profile_effect, pronouns, display_name, name_style,
                profile_tag, profile_links, custom_status_expires_at
         FROM users WHERE id=$1"
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Utilisateur introuvable".into()))?;

    let mut profile = serde_json::json!({
        "id":                   user.get::<Uuid, _>("id"),
        "username":             user.get::<String, _>("username"),
        "discriminator":        user.get::<String, _>("discriminator"),
        "avatar":               user.get::<Option<String>, _>("avatar"),
        "banner":               user.get::<Option<String>, _>("banner"),
        "bio":                  user.get::<Option<String>, _>("bio"),
        "status":               user.get::<String, _>("status"),
        "custom_status":        user.get::<Option<String>, _>("custom_status"),
        "custom_status_emoji":  user.get::<Option<String>, _>("custom_status_emoji"),
        "activity_type":        user.get::<Option<String>, _>("activity_type"),
        "activity_name":        user.get::<Option<String>, _>("activity_name"),
        "activity_detail":      user.get::<Option<String>, _>("activity_detail"),
        "verified":             user.get::<bool, _>("is_verified"),
        "created_at":           user.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
        "avatar_decoration":    user.get::<Option<String>, _>("avatar_decoration"),
        "profile_color_primary": user.get::<Option<i32>, _>("profile_color_primary"),
        "profile_color_accent": user.get::<Option<i32>, _>("profile_color_accent"),
        "profile_effect":       user.get::<Option<String>, _>("profile_effect"),
        "pronouns":             user.get::<Option<String>, _>("pronouns"),
        "display_name":         user.get::<Option<String>, _>("display_name"),
        "name_style":           user.get::<Option<serde_json::Value>, _>("name_style"),
        "profile_tag":          user.get::<Option<String>, _>("profile_tag"),
        "profile_links":        user.get::<Option<serde_json::Value>, _>("profile_links"),
        "custom_status_expires_at": user.get::<Option<chrono::DateTime<chrono::Utc>>, _>("custom_status_expires_at"),
        "relationship":         "none",
        "is_favorite":          false,
    });

    let mut is_self = false;
    let mut is_friend = false;

    if let Some(Extension(claims)) = claims {
        let me = claims.sub;
        if me == user_id {
            is_self = true;
            profile["relationship"] = serde_json::json!("self");
        } else {
            // Amitié
            let friendship = sqlx::query(
                "SELECT id, status, user_id FROM friendships
                 WHERE (user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)"
            )
            .bind(me)
            .bind(user_id)
            .fetch_optional(&state.db)
            .await?;

            if let Some(f) = friendship {
                let friendship_id: Uuid = f.get("id");
                profile["friendship_id"] = serde_json::json!(friendship_id);
                let status: &str = match f.get::<String, _>("status").as_str() {
                    "accepted" => { is_friend = true; "friend" }
                    "pending" => {
                        let initiator: Uuid = f.get("user_id");
                        if initiator == me { "pending_sent" } else { "pending_received" }
                    }
                    _ => "none",
                };
                profile["relationship"] = serde_json::json!(status);
            }

            // Bloqué
            let blocked = sqlx::query(
                "SELECT 1 FROM blocks WHERE blocker_id=$1 AND blocked_id=$2"
            )
            .bind(me)
            .bind(user_id)
            .fetch_optional(&state.db)
            .await?;
            if blocked.is_some() {
                profile["relationship"] = serde_json::json!("blocked");
            }

            // Favori
            let fav = sqlx::query(
                "SELECT 1 FROM user_favorites WHERE user_id=$1 AND target_id=$2"
            )
            .bind(me)
            .bind(user_id)
            .fetch_optional(&state.db)
            .await?;
            profile["is_favorite"] = serde_json::json!(fav.is_some());

            // Serveurs en commun
            let mutual = sqlx::query(
                "SELECT s.id, s.name, s.icon FROM server_members sm1
                 JOIN server_members sm2 ON sm1.server_id = sm2.server_id AND sm2.user_id=$2
                 JOIN servers s ON s.id = sm1.server_id
                 WHERE sm1.user_id=$1 LIMIT 5"
            )
            .bind(me)
            .bind(user_id)
            .fetch_all(&state.db)
            .await?;

            let mutual_servers: Vec<serde_json::Value> = mutual.iter().map(|r| serde_json::json!({
                "id":   r.get::<Uuid, _>("id"),
                "name": r.get::<String, _>("name"),
                "icon": r.get::<Option<String>, _>("icon"),
            })).collect();
            profile["mutual_servers"] = serde_json::json!(mutual_servers);
        }
    }

    // `activity_visibility` (everyone/friends/nobody, réglage du TARGET) était stocké et
    // relu correctement dans les Réglages mais jamais consulté ici -- l'activité était
    // toujours visible par n'importe qui, y compris un visiteur anonyme, peu importe le
    // réglage choisi.
    if !is_self {
        let visibility: Option<String> = sqlx::query_scalar(
            "SELECT activity_visibility FROM user_settings WHERE user_id=$1"
        )
        .bind(user_id)
        .fetch_optional(&state.db)
        .await?;

        let show_activity = match visibility.as_deref() {
            Some("nobody") => false,
            Some("friends") => is_friend,
            _ => true, // "everyone" ou pas de préférence enregistrée
        };

        if !show_activity {
            profile["activity_type"] = serde_json::Value::Null;
            profile["activity_name"] = serde_json::Value::Null;
            profile["activity_detail"] = serde_json::Value::Null;
        }
    }

    Ok(Json(profile))
}

/// GET /api/users/:id/profile (route publique — JWT optionnel, cookie OU Bearer)
pub async fn get_user_profile_public(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    // Priorité : cookie access_token > Authorization: Bearer (identique au middleware auth)
    let token = headers
        .get("cookie")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| {
            s.split(';').find_map(|part| {
                part.trim().strip_prefix("access_token=").map(|t| t.to_string())
            })
        })
        .or_else(|| {
            headers
                .get("Authorization")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.strip_prefix("Bearer "))
                .map(|t| t.to_string())
        });

    let claims = token
        .and_then(|token| crate::middleware::auth::verify_token(
            &token,
            &state.config.jwt_secret,
            &state.config.jwt_issuer,
        ))
        .map(Extension);

    get_user_profile(State(state), claims, Path(user_id)).await
}

// ─── Status rapide ────────────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
pub struct UpdateStatusRequest {
    pub status: Option<String>,
    pub custom_status: Option<String>,
    pub custom_status_emoji: Option<String>,
    /// Effacer le statut personnalisé après N minutes (0 = jamais).
    pub clear_after_minutes: Option<i64>,
}

/// PATCH /api/user/status — statut choisi et/ou statut personnalisé.
/// Une chaîne vide efface le statut personnalisé (ou son émoji).
pub async fn update_status(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<UpdateStatusRequest>,
) -> Result<Json<serde_json::Value>> {
    if let Some(ref s) = req.status {
        if !crate::handlers::presence::CHOOSABLE.contains(&s.as_str()) {
            return Err(AppError::BadRequest("Statut invalide (online|idle|dnd|invisible)".into()));
        }
    }

    let custom_status = req.custom_status.map(|s| s.trim().chars().take(128).collect::<String>());
    let custom_status_emoji = req.custom_status_emoji.map(|s| s.trim().chars().take(8).collect::<String>());
    let expires = crate::handlers::profile_custom::status_expiry(req.clear_after_minutes)?;

    // P1-9 — `COALESCE` empêchait d'effacer : une chaîne vide vaut désormais NULL.
    let row = sqlx::query(
        "UPDATE users SET
            preferred_status = COALESCE($1, preferred_status),
            custom_status = CASE WHEN $2::TEXT IS NOT NULL THEN NULLIF($2, '') ELSE custom_status END,
            custom_status_emoji = CASE WHEN $3::TEXT IS NOT NULL THEN NULLIF($3, '') ELSE custom_status_emoji END,
            custom_status_expires_at = CASE WHEN $2::TEXT IS NOT NULL OR $3::TEXT IS NOT NULL THEN $5 ELSE custom_status_expires_at END,
            updated_at = NOW()
         WHERE id = $4
         RETURNING preferred_status, custom_status, custom_status_emoji, custom_status_expires_at"
    )
    .bind(&req.status)
    .bind(&custom_status)
    .bind(&custom_status_emoji)
    .bind(claims.sub)
    .bind(expires)
    .fetch_one(&state.db)
    .await?;

    use sqlx::Row;
    let expires: Option<chrono::DateTime<chrono::Utc>> = row.get("custom_status_expires_at");
    let preferred: String = row.get("preferred_status");
    let custom_status: Option<String> = row.get("custom_status");
    let custom_status_emoji: Option<String> = row.get("custom_status_emoji");

    if req.status.is_some() {
        crate::handlers::presence::refresh(&state, claims.sub).await;
    }

    // Statut personnalisé : membres des serveurs communs + ses autres sessions.
    // Le statut en direct passe par presence::refresh (jamais « invisible » ici).
    crate::handlers::profile_custom::broadcast_custom_status(&state, claims.sub, custom_status.as_deref(), custom_status_emoji.as_deref(), expires).await;

    Ok(Json(serde_json::json!({
        "ok": true,
        "status": preferred,
        "custom_status": custom_status,
        "custom_status_emoji": custom_status_emoji,
        "custom_status_expires_at": expires,
    })))
}

// ─── Activity Feed ────────────────────────────────────────────────────────────

/// GET /api/activity-feed — événements typés des serveurs communs (48h)
pub async fn get_activity_feed(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<Vec<serde_json::Value>>> {
    use sqlx::Row;

    let limit: i64 = params.get("limit").and_then(|s| s.parse().ok()).unwrap_or(20);
    let offset: i64 = params.get("offset").and_then(|s| s.parse().ok()).unwrap_or(0);

    // Nouvelles arrivées dans les serveurs communs (amis exclus — couverts par friend_join_rows
    // ci-dessous avec un rendu dédié, sinon le même événement apparaîtrait deux fois dans "Tout")
    let join_rows = sqlx::query(
        "SELECT sm.joined_at as ts, u.id as user_id, u.username, u.avatar,
                s.id as server_id, s.name as server_name
         FROM server_members sm
         JOIN users u ON u.id = sm.user_id
         JOIN servers s ON s.id = sm.server_id
         JOIN server_members my_sm ON my_sm.server_id = s.id AND my_sm.user_id = $1
         WHERE sm.user_id != $1
           AND sm.joined_at > NOW() - INTERVAL '48 hours'
           AND NOT EXISTS (
               SELECT 1 FROM friendships f
               WHERE f.status = 'accepted'
                 AND ((f.user_id = $1 AND f.friend_id = sm.user_id)
                   OR (f.friend_id = $1 AND f.user_id = sm.user_id))
           )
         ORDER BY sm.joined_at DESC
         LIMIT 30"
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    // Arrivées d'amis dans des serveurs communs (sous-ensemble de join_rows, filtré amitié acceptée)
    let friend_join_rows = sqlx::query(
        "SELECT sm.joined_at as ts, u.id as user_id, u.username, u.avatar,
                s.id as server_id, s.name as server_name
         FROM server_members sm
         JOIN users u ON u.id = sm.user_id
         JOIN servers s ON s.id = sm.server_id
         JOIN server_members my_sm ON my_sm.server_id = s.id AND my_sm.user_id = $1
         JOIN friendships f ON f.status = 'accepted'
             AND ((f.user_id = $1 AND f.friend_id = sm.user_id)
               OR (f.friend_id = $1 AND f.user_id = sm.user_id))
         WHERE sm.user_id != $1
           AND sm.joined_at > NOW() - INTERVAL '48 hours'
         ORDER BY sm.joined_at DESC
         LIMIT 30"
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    // Messages épinglés dans les serveurs communs
    let pin_rows = sqlx::query(
        "SELECT pm.pinned_at as ts, u.id as user_id, u.username, u.avatar,
                s.id as server_id, s.name as server_name,
                c.id as channel_id, c.name as channel_name
         FROM pinned_messages pm
         JOIN users u ON u.id = pm.pinned_by
         JOIN channels c ON c.id = pm.channel_id
         JOIN servers s ON s.id = c.server_id
         JOIN server_members sm ON sm.server_id = s.id AND sm.user_id = $1
         WHERE pm.pinned_at > NOW() - INTERVAL '48 hours'
         ORDER BY pm.pinned_at DESC
         LIMIT 30"
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    let mut items: Vec<serde_json::Value> = Vec::new();

    for r in &join_rows {
        items.push(serde_json::json!({
            "id": Uuid::new_v4(),
            "type": "server_join",
            "actor": {
                "id":       r.get::<Uuid, _>("user_id"),
                "username": r.get::<String, _>("username"),
                "avatar":   r.get::<Option<String>, _>("avatar"),
            },
            "server": {
                "id":   r.get::<Uuid, _>("server_id"),
                "name": r.get::<String, _>("server_name"),
            },
            "timestamp": r.get::<chrono::DateTime<chrono::Utc>, _>("ts"),
        }));
    }

    for r in &friend_join_rows {
        items.push(serde_json::json!({
            "id": Uuid::new_v4(),
            "type": "friend_join_server",
            "actor": {
                "id":       r.get::<Uuid, _>("user_id"),
                "username": r.get::<String, _>("username"),
                "avatar":   r.get::<Option<String>, _>("avatar"),
            },
            "server": {
                "id":   r.get::<Uuid, _>("server_id"),
                "name": r.get::<String, _>("server_name"),
            },
            "timestamp": r.get::<chrono::DateTime<chrono::Utc>, _>("ts"),
        }));
    }

    for r in &pin_rows {
        items.push(serde_json::json!({
            "id": Uuid::new_v4(),
            "type": "message_pin",
            "actor": {
                "id":       r.get::<Uuid, _>("user_id"),
                "username": r.get::<String, _>("username"),
                "avatar":   r.get::<Option<String>, _>("avatar"),
            },
            "server": {
                "id":   r.get::<Uuid, _>("server_id"),
                "name": r.get::<String, _>("server_name"),
            },
            "channel": {
                "id":   r.get::<Uuid, _>("channel_id"),
                "name": r.get::<String, _>("channel_name"),
            },
            "timestamp": r.get::<chrono::DateTime<chrono::Utc>, _>("ts"),
        }));
    }

    // Tri chronologique décroissant
    items.sort_by(|a, b| {
        let ta = a["timestamp"].as_str().unwrap_or("");
        let tb = b["timestamp"].as_str().unwrap_or("");
        tb.cmp(ta)
    });

    let off = offset as usize;
    let end = (off + limit as usize).min(items.len());
    let page = if off < items.len() { items[off..end].to_vec() } else { vec![] };

    Ok(Json(page))
}

pub async fn get_mutual_servers(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT s.id, s.name, s.icon,
                COALESCE(
                    (SELECT array_agg(r.name)
                     FROM roles r
                     INNER JOIN server_member_roles smr ON smr.role_id = r.id
                     WHERE smr.server_id = s.id AND smr.user_id = $2
                       AND r.is_everyone = false),
                    ARRAY[]::text[]
                ) AS member_role_names
         FROM servers s
         INNER JOIN server_members sm1 ON sm1.server_id = s.id AND sm1.user_id = $1
         INNER JOIN server_members sm2 ON sm2.server_id = s.id AND sm2.user_id = $2
         LIMIT 10"
    )
    .bind(claims.sub)
    .bind(user_id)
    .fetch_all(&state.db)
    .await?;

    let servers: Vec<serde_json::Value> = rows.iter().map(|r| {
        let member_role_names: Vec<String> = r.try_get("member_role_names").unwrap_or_default();
        serde_json::json!({
            "id":   r.get::<Uuid, _>("id"),
            "name": r.get::<String, _>("name"),
            "icon": r.get::<Option<String>, _>("icon"),
            "member_role_names": member_role_names,
        })
    }).collect();

    Ok(Json(serde_json::json!(servers)))
}

pub async fn get_my_stats(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;
    let uid = claims.sub;

    // Compte les 3 sources de messages (serveur + DM 1:1 + group DM) --
    // ne compter que `messages` sous-évaluait fortement tout utilisateur
    // actif surtout en DM.
    let msg_row = sqlx::query(
        "SELECT (
            (SELECT COUNT(*) FROM messages WHERE user_id=$1) +
            (SELECT COUNT(*) FROM dm_messages WHERE sender_id=$1) +
            (SELECT COUNT(*) FROM group_dm_messages WHERE sender_id=$1)
         )::bigint as total"
    )
    .bind(uid).fetch_one(&state.db).await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("{}", e)))?;
    let messages_sent: i64 = msg_row.get("total");

    let server_row = sqlx::query(
        "SELECT COUNT(*)::bigint as total FROM server_members WHERE user_id=$1"
    )
    .bind(uid).fetch_one(&state.db).await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("{}", e)))?;
    let servers_joined: i64 = server_row.get("total");

    let friend_row = sqlx::query(
        "SELECT COUNT(*)::bigint as total FROM friendships WHERE (user_id=$1 OR friend_id=$1) AND status='accepted'"
    )
    .bind(uid).fetch_one(&state.db).await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("{}", e)))?;
    let friends_count: i64 = friend_row.get("total");

    let react_given_row = sqlx::query(
        "SELECT (
            (SELECT COUNT(*) FROM reactions WHERE user_id=$1) +
            (SELECT COUNT(*) FROM dm_reactions WHERE user_id=$1) +
            (SELECT COUNT(*) FROM group_dm_reactions WHERE user_id=$1)
         )::bigint as total"
    )
    .bind(uid).fetch_one(&state.db).await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("{}", e)))?;
    let reactions_given: i64 = react_given_row.get("total");

    let react_recv_row = sqlx::query(
        "SELECT (
            (SELECT COUNT(*) FROM reactions r JOIN messages m ON m.id = r.message_id WHERE m.user_id=$1) +
            (SELECT COUNT(*) FROM dm_reactions r JOIN dm_messages m ON m.id = r.dm_message_id WHERE m.sender_id=$1) +
            (SELECT COUNT(*) FROM group_dm_reactions r JOIN group_dm_messages m ON m.id = r.group_dm_message_id WHERE m.sender_id=$1)
         )::bigint as total"
    )
    .bind(uid).fetch_one(&state.db).await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("{}", e)))?;
    let reactions_received: i64 = react_recv_row.get("total");

    let user_row = sqlx::query(
        "SELECT created_at FROM users WHERE id=$1"
    )
    .bind(uid).fetch_one(&state.db).await
    .map_err(|_| AppError::NotFound("Utilisateur introuvable".into()))?;
    let created_at: chrono::DateTime<chrono::Utc> = user_row.get("created_at");

    Ok(Json(serde_json::json!({
        "messages_sent": messages_sent,
        "servers_joined": servers_joined,
        "friends_count": friends_count,
        "reactions_given": reactions_given,
        "reactions_received": reactions_received,
        "member_since": created_at.to_rfc3339(),
    })))
}

pub async fn toggle_focus_mode(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>> {
    let enabled = body["enabled"].as_bool().unwrap_or(false);
    sqlx::query("UPDATE users SET focus_mode=$1, updated_at=NOW() WHERE id=$2")
        .bind(enabled)
        .bind(claims.sub)
        .execute(&state.db)
        .await?;
    Ok(Json(serde_json::json!({ "ok": true, "focus_mode": enabled })))
}
