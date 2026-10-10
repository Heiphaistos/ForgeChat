//! Lot « Profil et social » : fiche sociale d'un utilisateur (statut riche,
//! badges, anniversaire visible), favoris épinglés et ordre des groupes d'amis.

use std::collections::HashSet;

use axum::{extract::{Path, State}, Extension, Json};
use chrono::Datelike;
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::{badges, birthdays, presence},
    middleware::auth::Claims,
    state::AppState,
};

async fn are_friends(state: &AppState, a: Uuid, b: Uuid) -> Result<bool> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM friendships WHERE status='accepted' AND
         ((user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)))",
    )
    .bind(a)
    .bind(b)
    .fetch_one(&state.db)
    .await?)
}

/// GET /users/:id/social — « en appel », badges et anniversaire (jour/mois) visibles par moi.
pub async fn get_user_social(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    let status: String = sqlx::query_scalar("SELECT status FROM users WHERE id=$1")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Utilisateur introuvable".into()))?;
    let is_self = user_id == claims.sub;
    let is_friend = !is_self && are_friends(&state, claims.sub, user_id).await?;
    let in_call = if status == "offline" && !is_self {
        false
    } else {
        let rich = presence::load_rich(&state, &[user_id]).await.remove(&user_id).unwrap_or_default();
        rich.view(is_self, is_friend)["in_call"] == true
    };
    let facts = badges::facts(&state, user_id).await;
    Ok(Json(serde_json::json!({
        "in_call": in_call,
        "badges": badges::badges(&facts),
        "birthday": birthdays::for_viewer(&state, user_id, claims.sub, is_friend).await,
    })))
}

/// Ajoute aux amis acceptés de GET /friends/v2 : favori, statut riche filtré par
/// la visibilité de chacun, et anniversaire (jour/mois) s'il est montré aux amis.
pub async fn enrich_friends(state: &AppState, me: Uuid, rows: &mut [serde_json::Value]) {
    let ids: Vec<Uuid> = rows
        .iter()
        .filter(|r| r["status"] == "accepted")
        .filter_map(|r| r["friend_id"].as_str().and_then(|s| s.parse().ok()))
        .collect();
    if ids.is_empty() {
        return;
    }
    let rich = presence::load_rich(state, &ids).await;
    let favorites: HashSet<Uuid> = sqlx::query_scalar("SELECT target_id FROM user_favorites WHERE user_id=$1")
        .bind(me)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default()
        .into_iter()
        .collect();
    let birthdays: std::collections::HashMap<Uuid, chrono::NaiveDate> = sqlx::query_as::<_, (Uuid, String)>(
        "SELECT id, birthday_enc FROM users WHERE id = ANY($1) AND birthday_enc IS NOT NULL
           AND birthday_visibility IN ('friends','servers')",
    )
    .bind(&ids)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default()
    .into_iter()
    .filter_map(|(id, enc)| Some((id, birthdays::open(id, &enc)?)))
    .collect();
    for r in rows.iter_mut().filter(|r| r["status"] == "accepted") {
        let Some(id) = r["friend_id"].as_str().and_then(|s| s.parse::<Uuid>().ok()) else { continue };
        let offline = r["user_status"] == "offline";
        let view = match rich.get(&id) {
            Some(rs) if !offline => rs.view(false, true),
            _ => presence::RichStatus::default().view(false, true),
        };
        for k in ["activity_type", "activity_name", "activity_detail", "in_call"] {
            r[k] = view[k].clone();
        }
        r["is_favorite"] = favorites.contains(&id).into();
        r["birthday"] = birthdays
            .get(&id)
            .map(|d| serde_json::json!({ "month": d.month(), "day": d.day() }))
            .unwrap_or(serde_json::Value::Null);
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FavoriteBody {
    pub favorite: bool,
}

/// PUT /friends/:id/favorite { favorite } — ami épinglé en haut de la liste.
pub async fn set_favorite(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(target_id): Path<Uuid>,
    Json(body): Json<FavoriteBody>,
) -> Result<Json<serde_json::Value>> {
    if body.favorite {
        if !are_friends(&state, claims.sub, target_id).await? {
            return Err(AppError::Forbidden);
        }
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM user_favorites WHERE user_id=$1")
            .bind(claims.sub)
            .fetch_one(&state.db)
            .await?;
        if count >= 50 {
            return Err(AppError::BadRequest("50 favoris au plus".into()));
        }
        sqlx::query("INSERT INTO user_favorites (user_id, target_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
            .bind(claims.sub)
            .bind(target_id)
            .execute(&state.db)
            .await?;
    } else {
        sqlx::query("DELETE FROM user_favorites WHERE user_id=$1 AND target_id=$2")
            .bind(claims.sub)
            .bind(target_id)
            .execute(&state.db)
            .await?;
    }
    Ok(Json(serde_json::json!({ "ok": true, "favorite": body.favorite })))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OrderBody {
    pub ids: Vec<Uuid>,
}

/// PUT /friends/groups/order { ids } — nouvel ordre de mes groupes d'amis.
pub async fn order_groups(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<OrderBody>,
) -> Result<Json<serde_json::Value>> {
    if body.ids.len() > 20 {
        return Err(AppError::BadRequest("20 groupes au plus".into()));
    }
    // Position = rang dans la liste ; seuls mes groupes sont touchés (IDOR).
    sqlx::query(
        "UPDATE friend_groups fg SET position = o.pos - 1
         FROM UNNEST($2::uuid[]) WITH ORDINALITY AS o(id, pos)
         WHERE fg.id = o.id AND fg.user_id = $1",
    )
    .bind(claims.sub)
    .bind(&body.ids)
    .execute(&state.db)
    .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Couleur de groupe : #RRGGBB ou rien (jamais de CSS arbitraire).
pub fn valid_group_color(c: &str) -> bool {
    c.is_empty() || (c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|ch| ch.is_ascii_hexdigit()))
}

#[cfg(test)]
mod tests {
    #[test]
    fn couleur_de_groupe() {
        assert!(super::valid_group_color("#a1B2c3"));
        assert!(super::valid_group_color(""));
        assert!(!super::valid_group_color("red;background:url(x)"));
        assert!(!super::valid_group_color("#12345"));
    }
}
