use axum::{
    extract::{Path, State},
    Extension, Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{error::AppError, middleware::auth::Claims, state::AppState};

#[derive(Deserialize)]
pub struct CreatePollBody {
    pub question: String,
    pub options: Vec<String>,
    pub multiple_choice: Option<bool>,
    pub anonymous: Option<bool>,
    pub ends_at: Option<DateTime<Utc>>,
}

#[derive(Serialize)]
pub struct PollOption {
    pub id: Uuid,
    pub text: String,
    pub position: i32,
    pub votes: i64,
    pub voted: bool,
}

#[derive(Serialize)]
pub struct PollResponse {
    pub id: Uuid,
    pub question: String,
    pub channel_id: Uuid,
    pub creator_id: Uuid,
    pub multiple_choice: bool,
    pub anonymous: bool,
    pub ends_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub options: Vec<PollOption>,
    pub total_votes: i64,
}

pub async fn create_poll(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<CreatePollBody>,
) -> Result<Json<PollResponse>, AppError> {
    if body.question.trim().is_empty() || body.question.len() > 300 {
        return Err(AppError::BadRequest("Question invalide".into()));
    }
    if body.options.len() < 2 || body.options.len() > 10 {
        return Err(AppError::BadRequest("Entre 2 et 10 options requises".into()));
    }

    let poll_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO polls (id, channel_id, server_id, creator_id, question, multiple_choice, anonymous, ends_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)"
    )
    .bind(poll_id)
    .bind(channel_id)
    .bind(server_id)
    .bind(claims.sub)
    .bind(&body.question)
    .bind(body.multiple_choice.unwrap_or(false))
    .bind(body.anonymous.unwrap_or(false))
    .bind(body.ends_at)
    .execute(&state.db)
    .await?;

    let mut options = Vec::new();
    for (i, text) in body.options.iter().enumerate() {
        let opt_id = Uuid::new_v4();
        sqlx::query("INSERT INTO poll_options (id, poll_id, text, position) VALUES ($1,$2,$3,$4)")
            .bind(opt_id)
            .bind(poll_id)
            .bind(text)
            .bind(i as i32)
            .execute(&state.db)
            .await?;
        options.push(PollOption { id: opt_id, text: text.clone(), position: i as i32, votes: 0, voted: false });
    }

    let row = sqlx::query("SELECT multiple_choice, anonymous, ends_at, created_at FROM polls WHERE id=$1")
        .bind(poll_id)
        .fetch_one(&state.db)
        .await?;
    use sqlx::Row;

    let poll = PollResponse {
        id: poll_id,
        question: body.question,
        channel_id,
        creator_id: claims.sub,
        multiple_choice: row.get("multiple_choice"),
        anonymous: row.get("anonymous"),
        ends_at: row.get("ends_at"),
        created_at: row.get("created_at"),
        options,
        total_votes: 0,
    };

    let event = serde_json::json!({
        "type": "POLL_CREATE",
        "channel_id": channel_id,
        "poll": &poll,
    });
    state.broadcast_to_channel_members(channel_id, event.to_string()).await;

    Ok(Json(poll))
}

pub async fn get_poll(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((_server_id, _channel_id, poll_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Json<PollResponse>, AppError> {
    use sqlx::Row;
    let row = sqlx::query(
        "SELECT id, question, channel_id, creator_id, multiple_choice, anonymous, ends_at, created_at
         FROM polls WHERE id=$1"
    )
    .bind(poll_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Sondage introuvable".into()))?;

    let options_rows = sqlx::query(
        "SELECT po.id, po.text, po.position,
                COUNT(pv.user_id) AS votes,
                BOOL_OR(pv.user_id=$2) AS voted
         FROM poll_options po
         LEFT JOIN poll_votes pv ON pv.option_id=po.id
         WHERE po.poll_id=$1
         GROUP BY po.id, po.text, po.position
         ORDER BY po.position"
    )
    .bind(poll_id)
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    let mut total_votes: i64 = 0;
    let options: Vec<PollOption> = options_rows.iter().map(|r| {
        let v: i64 = r.get("votes");
        total_votes += v;
        PollOption {
            id: r.get("id"),
            text: r.get("text"),
            position: r.get("position"),
            votes: v,
            voted: r.get::<Option<bool>, _>("voted").unwrap_or(false),
        }
    }).collect();

    Ok(Json(PollResponse {
        id: row.get("id"),
        question: row.get("question"),
        channel_id: row.get("channel_id"),
        creator_id: row.get("creator_id"),
        multiple_choice: row.get("multiple_choice"),
        anonymous: row.get("anonymous"),
        ends_at: row.get("ends_at"),
        created_at: row.get("created_at"),
        options,
        total_votes,
    }))
}

#[derive(Deserialize)]
pub struct VoteBody {
    pub option_ids: Vec<Uuid>,
}

pub async fn vote_poll(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((_server_id, channel_id, poll_id)): Path<(Uuid, Uuid, Uuid)>,
    Json(body): Json<VoteBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    use sqlx::Row;
    let row = sqlx::query("SELECT multiple_choice, ends_at FROM polls WHERE id=$1")
        .bind(poll_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Sondage introuvable".into()))?;

    let multiple_choice: bool = row.get("multiple_choice");
    let ends_at: Option<DateTime<Utc>> = row.get("ends_at");
    if let Some(end) = ends_at {
        if Utc::now() > end {
            return Err(AppError::BadRequest("Sondage terminé".into()));
        }
    }
    if !multiple_choice && body.option_ids.len() != 1 {
        return Err(AppError::BadRequest("Un seul choix autorisé".into()));
    }

    if body.option_ids.is_empty() {
        return Err(AppError::BadRequest("Au moins une option requise".into()));
    }

    // Vérifier que tous les option_ids appartiennent bien à ce sondage (IDOR protection)
    let valid_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM poll_options WHERE poll_id=$1 AND id = ANY($2)"
    )
    .bind(poll_id)
    .bind(&body.option_ids)
    .fetch_one(&state.db)
    .await?;

    if valid_count as usize != body.option_ids.len() {
        return Err(AppError::BadRequest("Options invalides pour ce sondage".into()));
    }

    // Supprimer les anciens votes
    sqlx::query("DELETE FROM poll_votes WHERE poll_id=$1 AND user_id=$2")
        .bind(poll_id).bind(claims.sub).execute(&state.db).await?;

    for opt_id in &body.option_ids {
        sqlx::query("INSERT INTO poll_votes (poll_id, option_id, user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING")
            .bind(poll_id).bind(opt_id).bind(claims.sub).execute(&state.db).await?;
    }

    let event = serde_json::json!({
        "type": "POLL_VOTE",
        "poll_id": poll_id,
        "channel_id": channel_id,
        "user_id": claims.sub,
    });
    state.broadcast_to_channel_members(channel_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}
