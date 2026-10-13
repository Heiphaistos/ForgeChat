//! Onboarding de serveur (comme Discord) : le propriétaire pose des questions,
//! chaque réponse donne des rôles et/ou rend visibles des salons. Un nouveau
//! membre répond à son arrivée (après la barrière de vérification) et peut
//! modifier ses réponses ensuite.

use std::collections::{HashMap, HashSet};

use axum::{
    extract::{Path, State},
    Extension, Json,
};
use serde::Deserialize;
use sqlx::Row;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::servers::{require_member, require_owner},
    middleware::auth::Claims,
    models::role::Permissions as P,
    state::AppState,
};

const MAX_QUESTIONS: usize = 10;
const MAX_OPTIONS: usize = 10;
const MAX_ROLES_PER_OPTION: usize = 5;
const MAX_CHANNELS_PER_OPTION: usize = 10;

/// Seules permissions qu'un rôle d'onboarding peut porter : rien qui modère,
/// administre ou notifie tout le serveur. Un membre choisit ses réponses lui-même.
const SAFE_PERMS: i64 = P::VIEW_CHANNEL | P::SEND_MESSAGES | P::READ_HISTORY | P::ATTACH_FILES
    | P::EMBED_LINKS | P::ADD_REACTIONS | P::CONNECT_VOICE | P::SPEAK_VOICE | P::STREAM;

/// Un rôle est attribuable par l'onboarding s'il n'est pas @everyone et n'accorde
/// rien au-delà de `SAFE_PERMS`.
pub fn role_grantable(perms: i64, is_everyone: bool) -> bool {
    !is_everyone && perms & !SAFE_PERMS == 0
}

/// Rôles réellement attribuables parmi `wanted` : ceux qui existent dans le
/// serveur (`roles` = id, permissions, is_everyone) et passent `role_grantable`.
/// Revérifié à chaque réponse : un rôle a pu être modifié depuis la configuration.
pub fn grantable_roles(wanted: &HashSet<Uuid>, roles: &[(Uuid, i64, bool)]) -> HashSet<Uuid> {
    roles.iter()
        .filter(|(id, perms, everyone)| wanted.contains(id) && role_grantable(*perms, *everyone))
        .map(|(id, _, _)| *id)
        .collect()
}

async fn server_roles(state: &AppState, server_id: Uuid) -> Result<Vec<(Uuid, i64, bool)>> {
    Ok(sqlx::query_as("SELECT id, permissions, is_everyone FROM roles WHERE server_id=$1")
        .bind(server_id)
        .fetch_all(&state.db)
        .await?)
}

/// GET /servers/:id/onboarding — questions et réponses actuelles du membre.
/// Les rôles et salons associés ne sont montrés qu'au propriétaire.
pub async fn get_onboarding(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    require_member(&state, claims.sub, server_id).await?;
    let is_owner = require_owner(&state, claims.sub, server_id).await.is_ok();
    let questions = sqlx::query("SELECT id, title, multiple FROM onboarding_questions WHERE server_id=$1 ORDER BY position")
        .bind(server_id)
        .fetch_all(&state.db)
        .await?;
    let options = sqlx::query(
        "SELECT o.id, o.question_id, o.label, o.role_ids, o.channel_ids FROM onboarding_options o
         JOIN onboarding_questions q ON q.id = o.question_id WHERE q.server_id=$1 ORDER BY o.position"
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;
    let selected: Vec<Uuid> = sqlx::query_scalar("SELECT option_id FROM onboarding_responses WHERE user_id=$1 AND server_id=$2")
        .bind(claims.sub)
        .bind(server_id)
        .fetch_all(&state.db)
        .await?;
    let questions: Vec<serde_json::Value> = questions.iter().map(|q| {
        let qid: Uuid = q.get("id");
        let opts: Vec<serde_json::Value> = options.iter()
            .filter(|o| o.get::<Uuid, _>("question_id") == qid)
            .map(|o| {
                let (roles, channels): (Vec<Uuid>, Vec<Uuid>) = if is_owner {
                    (o.get("role_ids"), o.get("channel_ids"))
                } else {
                    (vec![], vec![])
                };
                serde_json::json!({ "id": o.get::<Uuid, _>("id"), "label": o.get::<String, _>("label"),
                    "role_ids": roles, "channel_ids": channels })
            })
            .collect();
        serde_json::json!({ "id": qid, "title": q.get::<String, _>("title"),
            "multiple": q.get::<bool, _>("multiple"), "options": opts })
    }).collect();
    Ok(Json(serde_json::json!({ "questions": questions, "selected": selected })))
}

#[derive(Deserialize)]
pub struct OptionInput {
    pub id: Option<Uuid>,
    pub label: String,
    #[serde(default)]
    pub role_ids: Vec<Uuid>,
    #[serde(default)]
    pub channel_ids: Vec<Uuid>,
}

#[derive(Deserialize)]
pub struct QuestionInput {
    pub id: Option<Uuid>,
    pub title: String,
    #[serde(default)]
    pub multiple: bool,
    pub options: Vec<OptionInput>,
}

#[derive(Deserialize)]
pub struct OnboardingInput {
    pub questions: Vec<QuestionInput>,
}

fn clean_text(s: &str, what: &str) -> Result<String> {
    let t = s.trim();
    if t.is_empty() || t.chars().count() > 100 {
        return Err(AppError::BadRequest(format!("{what} : 1 à 100 caractères")));
    }
    Ok(t.to_string())
}

/// PUT /servers/:id/onboarding — remplace la configuration (propriétaire seul).
/// Les questions et réponses gardent leur identifiant si on le renvoie : les
/// membres ne perdent pas leurs choix à chaque modification.
pub async fn put_onboarding(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<OnboardingInput>,
) -> Result<Json<serde_json::Value>> {
    require_owner(&state, claims.sub, server_id).await?;
    if body.questions.len() > MAX_QUESTIONS {
        return Err(AppError::BadRequest(format!("{MAX_QUESTIONS} questions maximum")));
    }
    let roles = server_roles(&state, server_id).await?;
    let channels: HashSet<Uuid> = sqlx::query_scalar::<_, Uuid>("SELECT id FROM channels WHERE server_id=$1")
        .bind(server_id).fetch_all(&state.db).await?.into_iter().collect();
    for q in &body.questions {
        clean_text(&q.title, "Question")?;
        if q.options.is_empty() || q.options.len() > MAX_OPTIONS {
            return Err(AppError::BadRequest(format!("1 à {MAX_OPTIONS} réponses par question")));
        }
        for o in &q.options {
            clean_text(&o.label, "Réponse")?;
            if o.role_ids.len() > MAX_ROLES_PER_OPTION || o.channel_ids.len() > MAX_CHANNELS_PER_OPTION {
                return Err(AppError::BadRequest(format!(
                    "{MAX_ROLES_PER_OPTION} rôles et {MAX_CHANNELS_PER_OPTION} salons maximum par réponse")));
            }
            let wanted: HashSet<Uuid> = o.role_ids.iter().copied().collect();
            if grantable_roles(&wanted, &roles).len() != wanted.len() {
                return Err(AppError::BadRequest(
                    "Rôle refusé : seuls des rôles sans droit de modération ni d'administration peuvent être donnés".into()));
            }
            if !o.channel_ids.iter().all(|c| channels.contains(c)) {
                return Err(AppError::BadRequest("Salon introuvable dans ce serveur".into()));
            }
        }
    }

    let mut tx = state.db.begin().await?;
    let existing_q: HashSet<Uuid> = sqlx::query_scalar::<_, Uuid>("SELECT id FROM onboarding_questions WHERE server_id=$1")
        .bind(server_id).fetch_all(&mut *tx).await?.into_iter().collect();
    let existing_o: HashSet<Uuid> = sqlx::query_scalar::<_, Uuid>(
        "SELECT o.id FROM onboarding_options o JOIN onboarding_questions q ON q.id = o.question_id WHERE q.server_id=$1"
    ).bind(server_id).fetch_all(&mut *tx).await?.into_iter().collect();
    let (mut keep_q, mut keep_o) = (Vec::new(), Vec::new());
    for (qi, q) in body.questions.iter().enumerate() {
        // Un identifiant n'est réutilisé que s'il appartient déjà à CE serveur (IDOR).
        let qid: Uuid = match q.id.filter(|id| existing_q.contains(id) && !keep_q.contains(id)) {
            Some(id) => {
                sqlx::query("UPDATE onboarding_questions SET title=$2, multiple=$3, position=$4 WHERE id=$1")
                    .bind(id).bind(q.title.trim()).bind(q.multiple).bind(qi as i32).execute(&mut *tx).await?;
                id
            }
            None => sqlx::query_scalar(
                "INSERT INTO onboarding_questions (server_id, title, multiple, position) VALUES ($1, $2, $3, $4) RETURNING id"
            ).bind(server_id).bind(q.title.trim()).bind(q.multiple).bind(qi as i32).fetch_one(&mut *tx).await?,
        };
        keep_q.push(qid);
        for (oi, o) in q.options.iter().enumerate() {
            let oid: Uuid = match o.id.filter(|id| existing_o.contains(id) && !keep_o.contains(id)) {
                Some(id) => {
                    sqlx::query("UPDATE onboarding_options SET question_id=$2, label=$3, position=$4, role_ids=$5, channel_ids=$6 WHERE id=$1")
                        .bind(id).bind(qid).bind(o.label.trim()).bind(oi as i32).bind(&o.role_ids).bind(&o.channel_ids)
                        .execute(&mut *tx).await?;
                    id
                }
                None => sqlx::query_scalar(
                    "INSERT INTO onboarding_options (question_id, label, position, role_ids, channel_ids)
                     VALUES ($1, $2, $3, $4, $5) RETURNING id"
                ).bind(qid).bind(o.label.trim()).bind(oi as i32).bind(&o.role_ids).bind(&o.channel_ids)
                    .fetch_one(&mut *tx).await?,
            };
            keep_o.push(oid);
        }
    }
    // ponytail: les rôles déjà donnés par une réponse supprimée restent au membre ;
    // les retirer demanderait de rejouer les réponses de tous les membres.
    sqlx::query(
        "DELETE FROM onboarding_options o USING onboarding_questions q
         WHERE q.id = o.question_id AND q.server_id=$1 AND o.id <> ALL($2)"
    ).bind(server_id).bind(&keep_o).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM onboarding_questions WHERE server_id=$1 AND id <> ALL($2)")
        .bind(server_id).bind(&keep_q).execute(&mut *tx).await?;
    tx.commit().await?;
    get_onboarding(State(state), Extension(claims), Path(server_id)).await
}

#[derive(Deserialize)]
pub struct AnswersInput {
    pub option_ids: Vec<Uuid>,
}

/// PUT /servers/:id/onboarding/answers — enregistre (ou modifie) les réponses du
/// membre : attribue les rôles et salons des réponses choisies, retire ceux des
/// réponses abandonnées. Une liste vide vaut « passer ».
pub async fn put_answers(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<AnswersInput>,
) -> Result<Json<serde_json::Value>> {
    require_member(&state, claims.sub, server_id).await?;
    let user = claims.sub;
    // option -> (question, choix multiple, rôles, salons), pour CE serveur seulement.
    let options: HashMap<Uuid, (Uuid, bool, Vec<Uuid>, Vec<Uuid>)> = sqlx::query(
        "SELECT o.id, q.id AS qid, q.multiple, o.role_ids, o.channel_ids FROM onboarding_options o
         JOIN onboarding_questions q ON q.id = o.question_id WHERE q.server_id=$1"
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?
    .iter()
    .map(|r| (r.get("id"), (r.get("qid"), r.get("multiple"), r.get("role_ids"), r.get("channel_ids"))))
    .collect();

    let chosen: HashSet<Uuid> = body.option_ids.iter().copied().collect();
    let mut per_question: HashMap<Uuid, usize> = HashMap::new();
    for id in &chosen {
        let (qid, multiple, _, _) = options.get(id).ok_or_else(|| AppError::BadRequest("Réponse inconnue".into()))?;
        let n = per_question.entry(*qid).or_default();
        *n += 1;
        if !multiple && *n > 1 {
            return Err(AppError::BadRequest("Une seule réponse possible à cette question".into()));
        }
    }
    let old: HashSet<Uuid> = sqlx::query_scalar::<_, Uuid>("SELECT option_id FROM onboarding_responses WHERE user_id=$1 AND server_id=$2")
        .bind(user).bind(server_id).fetch_all(&state.db).await?.into_iter().collect();
    type OptionRow = (Uuid, bool, Vec<Uuid>, Vec<Uuid>);
    let union = |set: &HashSet<Uuid>, pick: fn(&OptionRow) -> &Vec<Uuid>| -> HashSet<Uuid> {
        set.iter().filter_map(|id| options.get(id)).flat_map(|o| pick(o).iter().copied()).collect()
    };
    let roles = server_roles(&state, server_id).await?;
    let new_roles = grantable_roles(&union(&chosen, |o| &o.2), &roles);
    let old_roles = grantable_roles(&union(&old, |o| &o.2), &roles);
    let new_channels = union(&chosen, |o| &o.3);
    let old_channels = union(&old, |o| &o.3);
    let add_roles: Vec<Uuid> = new_roles.iter().copied().collect();
    // ponytail: un rôle aussi donné à la main par un modérateur est retiré avec la réponse.
    // Jamais un rôle devenu sensible depuis : il n'est pas attribuable, donc pas retirable ici.
    let drop_roles: Vec<Uuid> = old_roles.difference(&new_roles).copied().collect();
    let add_channels: Vec<Uuid> = new_channels.iter().copied().collect();
    let drop_channels: Vec<Uuid> = old_channels.difference(&new_channels).copied().collect();
    let view = P::VIEW_CHANNEL;

    let mut tx = state.db.begin().await?;
    sqlx::query("DELETE FROM onboarding_responses WHERE user_id=$1 AND server_id=$2")
        .bind(user).bind(server_id).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO onboarding_responses (user_id, server_id, option_id) SELECT $1, $2, unnest($3::uuid[])")
        .bind(user).bind(server_id).bind(chosen.iter().copied().collect::<Vec<_>>()).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM member_roles WHERE user_id=$1 AND server_id=$2 AND role_id = ANY($3)")
        .bind(user).bind(server_id).bind(&drop_roles).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO member_roles (user_id, server_id, role_id) SELECT $1, $2, unnest($3::uuid[]) ON CONFLICT DO NOTHING")
        .bind(user).bind(server_id).bind(&add_roles).execute(&mut *tx).await?;
    // Salons : surcharge « membre » qui autorise la vue. Un refus explicite posé
    // par un modérateur n'est jamais levé par l'onboarding.
    sqlx::query(
        "UPDATE channel_permissions SET allow = allow & ~$3::bigint
         WHERE target_id=$1 AND target_type='member' AND channel_id = ANY($2)"
    ).bind(user).bind(&drop_channels).bind(view).execute(&mut *tx).await?;
    sqlx::query(
        "DELETE FROM channel_permissions WHERE target_id=$1 AND target_type='member' AND channel_id = ANY($2)
         AND allow = 0 AND deny = 0"
    ).bind(user).bind(&drop_channels).execute(&mut *tx).await?;
    sqlx::query(
        "INSERT INTO channel_permissions (channel_id, target_id, target_type, allow, deny)
         SELECT c.id, $1, 'member', $4, 0 FROM channels c WHERE c.id = ANY($2) AND c.server_id=$3
         ON CONFLICT (channel_id, target_id) DO UPDATE SET allow = channel_permissions.allow | $4
         WHERE channel_permissions.target_type='member' AND channel_permissions.deny & $4 = 0"
    ).bind(user).bind(&add_channels).bind(server_id).bind(view).execute(&mut *tx).await?;
    sqlx::query("UPDATE server_members SET onboarded_at=NOW() WHERE user_id=$1 AND server_id=$2")
        .bind(user).bind(server_id).execute(&mut *tx).await?;
    tx.commit().await?;

    if !add_roles.is_empty() || !drop_roles.is_empty() {
        state.broadcast_to_server_members(server_id, serde_json::json!({
            "type": "MEMBER_ROLE_UPDATE", "server_id": server_id, "user_id": user,
        }).to_string()).await;
    }
    if !add_channels.is_empty() || !drop_channels.is_empty() {
        state.send_to_users(&[user], serde_json::json!({
            "type": "CHANNEL_PERMISSION_UPDATE", "server_id": server_id,
        }).to_string()).await;
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roles_de_moderation_jamais_attribuables() {
        let (membre, admin, modo, everyone, autre) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
        let roles = vec![
            (membre, P::VIEW_CHANNEL | P::SEND_MESSAGES | P::CONNECT_VOICE, false),
            (admin, P::ADMINISTRATOR, false),
            (modo, P::SEND_MESSAGES | P::KICK_MEMBERS, false),
            (everyone, P::VIEW_CHANNEL, true),
        ];
        let wanted: HashSet<Uuid> = [membre, admin, modo, everyone, autre].into_iter().collect();
        // Seul le rôle sans droit sensible passe ; un rôle d'un autre serveur (absent) non plus.
        assert_eq!(grantable_roles(&wanted, &roles), [membre].into_iter().collect());
    }

    #[test]
    fn permissions_sensibles_refusees() {
        assert!(role_grantable(0, false));
        assert!(role_grantable(SAFE_PERMS, false));
        assert!(!role_grantable(0, true));
        for p in [P::MANAGE_ROLES, P::MANAGE_SERVER, P::MENTION_EVERYONE, P::BAN_TEMP, P::MOVE_MEMBERS, P::ADMINISTRATOR] {
            assert!(!role_grantable(P::VIEW_CHANNEL | p, false));
        }
    }
}
