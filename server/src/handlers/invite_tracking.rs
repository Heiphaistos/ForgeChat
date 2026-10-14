//! Suivi des invitations (MANAGE_SERVER) : pour chaque invitation, ses utilisations, son
//! créateur et les membres ACTUELS arrivés par elle (`server_members.joined_via_invite`,
//! renseigné par `servers::join_server` dans la transaction d'adhésion). Les invitations
//! supprimées qui ont amené des membres restent listées (`revoked: true`).

use axum::{
    extract::{Path, State},
    Extension, Json,
};
use chrono::{DateTime, Utc};
use serde::Serialize;
use std::collections::HashMap;
use uuid::Uuid;

use crate::{
    error::Result, handlers::servers::require_permission, middleware::auth::Claims,
    models::role::Permissions, state::AppState,
};

/// Membres listés au total (les plus récents) : borne la réponse sur un gros serveur.
pub const MEMBERS_MAX: i64 = 2000;

#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct UserBrief {
    pub id: Uuid,
    pub username: String,
    pub avatar: Option<String>,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct JoinedMember {
    pub user: UserBrief,
    pub joined_at: DateTime<Utc>,
}

#[derive(Serialize, Debug)]
pub struct TrackedInvite {
    pub code: String,
    pub uses: i32,
    pub max_uses: Option<i32>,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: Option<DateTime<Utc>>,
    /// Invitation supprimée depuis : seuls `code` et `members` restent connus.
    pub revoked: bool,
    pub inviter: Option<UserBrief>,
    pub members: Vec<JoinedMember>,
}

type MemberRow = (String, Uuid, String, Option<String>, DateTime<Utc>);
type InviteRow = (
    String,
    i32,
    Option<i32>,
    Option<DateTime<Utc>>,
    DateTime<Utc>,
    Option<Uuid>,
    Option<String>,
    Option<String>,
);

/// Regroupe les membres par code ; les codes sans invitation existante deviennent `revoked`.
pub fn group(
    invites: Vec<TrackedInvite>,
    members: Vec<(String, JoinedMember)>,
) -> Vec<TrackedInvite> {
    let mut by_code: HashMap<String, Vec<JoinedMember>> = HashMap::new();
    for (code, m) in members {
        by_code.entry(code).or_default().push(m);
    }
    let mut out: Vec<TrackedInvite> = invites
        .into_iter()
        .map(|mut i| {
            i.members = by_code.remove(&i.code).unwrap_or_default();
            i
        })
        .collect();
    let mut revoked: Vec<TrackedInvite> = by_code
        .into_iter()
        .map(|(code, members)| TrackedInvite {
            code,
            uses: members.len() as i32,
            max_uses: None,
            expires_at: None,
            created_at: None,
            revoked: true,
            inviter: None,
            members,
        })
        .collect();
    revoked.sort_by(|a, b| a.code.cmp(&b.code));
    out.extend(revoked);
    out
}

/// GET /servers/:server_id/invite-tracking
pub async fn list_invite_tracking(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Vec<TrackedInvite>>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_SERVER).await?;
    let invites: Vec<InviteRow> = sqlx::query_as(
        "SELECT i.code, i.uses, i.max_uses, i.expires_at, i.created_at, u.id, u.username, NULLIF(u.avatar, '')
         FROM invites i LEFT JOIN users u ON u.id = i.creator_id
         WHERE i.server_id = $1 ORDER BY i.created_at DESC LIMIT 100",
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;
    let members: Vec<MemberRow> = sqlx::query_as(
        "SELECT sm.joined_via_invite, u.id, u.username, NULLIF(u.avatar, ''), sm.joined_at
         FROM server_members sm JOIN users u ON u.id = sm.user_id
         WHERE sm.server_id = $1 AND sm.joined_via_invite IS NOT NULL
         ORDER BY sm.joined_at DESC LIMIT $2",
    )
    .bind(server_id)
    .bind(MEMBERS_MAX)
    .fetch_all(&state.db)
    .await?;

    let invites = invites
        .into_iter()
        .map(
            |(code, uses, max_uses, expires_at, created_at, uid, username, avatar)| TrackedInvite {
                code,
                uses,
                max_uses,
                expires_at,
                created_at: Some(created_at),
                revoked: false,
                inviter: uid.zip(username).map(|(id, username)| UserBrief {
                    id,
                    username,
                    avatar,
                }),
                members: vec![],
            },
        )
        .collect();
    let members = members
        .into_iter()
        .map(|(code, id, username, avatar, joined_at)| {
            (
                code,
                JoinedMember {
                    user: UserBrief {
                        id,
                        username,
                        avatar,
                    },
                    joined_at,
                },
            )
        })
        .collect();
    Ok(Json(group(invites, members)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn member(name: &str) -> JoinedMember {
        JoinedMember {
            user: UserBrief {
                id: Uuid::new_v4(),
                username: name.into(),
                avatar: None,
            },
            joined_at: Utc::now(),
        }
    }

    fn invite(code: &str) -> TrackedInvite {
        TrackedInvite {
            code: code.into(),
            uses: 2,
            max_uses: None,
            expires_at: None,
            created_at: Some(Utc::now()),
            revoked: false,
            inviter: None,
            members: vec![],
        }
    }

    #[test]
    fn members_grouped_by_code_and_revoked_kept() {
        let (a, b, c) = (member("a"), member("b"), member("c"));
        let out = group(
            vec![invite("AAAA1111"), invite("BBBB2222")],
            vec![
                ("AAAA1111".into(), a.clone()),
                ("ZZZZ9999".into(), c.clone()),
                ("AAAA1111".into(), b.clone()),
            ],
        );
        assert_eq!(out.len(), 3);
        assert_eq!(out[0].members, vec![a, b]);
        assert!(out[1].members.is_empty() && !out[1].revoked);
        assert_eq!(
            (out[2].code.as_str(), out[2].revoked, out[2].uses),
            ("ZZZZ9999", true, 1)
        );
        assert_eq!(out[2].members, vec![c]);
    }
}
