use axum::{
    extract::{Path, State},
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::Claims,
    state::AppState,
};

// ─── User Settings ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct UserSettings {
    pub font_family: String,
    pub font_size_px: i32,
    pub font_color: Option<String>,
    pub accent_color: Option<String>,
    pub bg_color: Option<String>,
    pub bg_image_url: Option<String>,
    pub interface_density: String,
    pub emoji_style: String,
    pub time_format: String,
    pub date_format: String,
    pub language: String,
    pub gif_autoplay: String,
    pub link_preview: bool,
    pub code_theme: String,
    pub message_grouping_minutes: i32,
    pub avatar_shape: String,
    pub streamer_mode: bool,
    pub quiet_hours_enabled: bool,
    pub quiet_hours_start: Option<String>,
    pub quiet_hours_end: Option<String>,
    pub reduce_motion: bool,
    pub high_contrast: bool,
    pub glassmorphism: bool,
    pub show_role_colors: bool,
    pub show_member_list_default: bool,
    pub sidebar_width_px: i32,
    pub pronouns: Option<String>,
    pub show_timestamps: String,
    pub message_display: String,
    pub colorblind_mode: String,
    pub dm_from_all: bool,
    pub show_online: bool,
    pub activity_visibility: String,
    pub friend_request_from: String,
    pub explicit_content_filter: String,
}

impl Default for UserSettings {
    fn default() -> Self {
        Self {
            font_family: "Inter".into(),
            font_size_px: 14,
            font_color: None,
            accent_color: None,
            bg_color: None,
            bg_image_url: None,
            interface_density: "normal".into(),
            emoji_style: "native".into(),
            time_format: "24h".into(),
            date_format: "DD/MM/YYYY".into(),
            language: "fr".into(),
            gif_autoplay: "always".into(),
            link_preview: true,
            code_theme: "dracula".into(),
            message_grouping_minutes: 5,
            avatar_shape: "round".into(),
            streamer_mode: false,
            quiet_hours_enabled: false,
            quiet_hours_start: None,
            quiet_hours_end: None,
            reduce_motion: false,
            high_contrast: false,
            glassmorphism: false,
            show_role_colors: true,
            show_member_list_default: true,
            sidebar_width_px: 240,
            pronouns: None,
            show_timestamps: "hover".into(),
            message_display: "normal".into(),
            colorblind_mode: "none".into(),
            dm_from_all: true,
            show_online: true,
            activity_visibility: "everyone".into(),
            friend_request_from: "everyone".into(),
            explicit_content_filter: "none".into(),
        }
    }
}

#[derive(Debug, Deserialize, Default)]
pub struct UpdateUserSettings {
    pub font_family: Option<String>,
    pub font_size_px: Option<i32>,
    pub font_color: Option<serde_json::Value>,
    pub accent_color: Option<serde_json::Value>,
    pub bg_color: Option<serde_json::Value>,
    pub bg_image_url: Option<serde_json::Value>,
    pub interface_density: Option<String>,
    pub emoji_style: Option<String>,
    pub time_format: Option<String>,
    pub date_format: Option<String>,
    pub language: Option<String>,
    pub gif_autoplay: Option<String>,
    pub link_preview: Option<bool>,
    pub code_theme: Option<String>,
    pub message_grouping_minutes: Option<i32>,
    pub avatar_shape: Option<String>,
    pub streamer_mode: Option<bool>,
    pub quiet_hours_enabled: Option<bool>,
    pub quiet_hours_start: Option<serde_json::Value>,
    pub quiet_hours_end: Option<serde_json::Value>,
    pub reduce_motion: Option<bool>,
    pub high_contrast: Option<bool>,
    pub glassmorphism: Option<bool>,
    pub show_role_colors: Option<bool>,
    pub show_member_list_default: Option<bool>,
    pub sidebar_width_px: Option<i32>,
    pub pronouns: Option<serde_json::Value>,
    pub show_timestamps: Option<String>,
    pub message_display: Option<String>,
    pub colorblind_mode: Option<String>,
    pub dm_from_all: Option<bool>,
    pub show_online: Option<bool>,
    pub activity_visibility: Option<String>,
    pub friend_request_from: Option<String>,
    pub explicit_content_filter: Option<String>,
}

fn opt_str(v: &Option<serde_json::Value>) -> Option<String> {
    match v {
        Some(serde_json::Value::String(s)) => Some(s.clone()),
        Some(serde_json::Value::Null) | None => None,
        _ => None,
    }
}

pub async fn get_user_settings(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
) -> Result<Json<UserSettings>> {
    let row = sqlx::query_as::<_, UserSettings>(
        "SELECT font_family, font_size_px, font_color, accent_color, bg_color, bg_image_url,
         interface_density, emoji_style, time_format, date_format, language, gif_autoplay,
         link_preview, code_theme, message_grouping_minutes, avatar_shape, streamer_mode,
         quiet_hours_enabled,
         CAST(quiet_hours_start AS TEXT) AS quiet_hours_start,
         CAST(quiet_hours_end AS TEXT) AS quiet_hours_end,
         reduce_motion, high_contrast, glassmorphism, show_role_colors,
         show_member_list_default, sidebar_width_px, pronouns,
         show_timestamps, message_display, colorblind_mode,
         dm_from_all, show_online, activity_visibility, friend_request_from, explicit_content_filter
         FROM user_settings WHERE user_id = $1"
    )
    .bind(claims.sub)
    .fetch_optional(&state.db)
    .await?
    .unwrap_or_default();

    Ok(Json(row))
}

pub async fn update_user_settings(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Json(body): Json<UpdateUserSettings>,
) -> Result<Json<UserSettings>> {
    if let Some(sz) = body.font_size_px {
        if !(10..=24).contains(&sz) {
            return Err(AppError::BadRequest("font_size_px doit être entre 10 et 24".into()));
        }
    }
    if let Some(w) = body.sidebar_width_px {
        if !(180..=400).contains(&w) {
            return Err(AppError::BadRequest("sidebar_width_px entre 180 et 400".into()));
        }
    }

    let font_color = opt_str(&body.font_color);
    let accent_color = opt_str(&body.accent_color);
    let bg_color = opt_str(&body.bg_color);
    let bg_image_url = opt_str(&body.bg_image_url);
    let quiet_hours_start = opt_str(&body.quiet_hours_start);
    let quiet_hours_end = opt_str(&body.quiet_hours_end);
    let pronouns = opt_str(&body.pronouns);

    sqlx::query(
        "INSERT INTO user_settings (
           user_id, font_family, font_size_px, font_color, accent_color, bg_color, bg_image_url,
           interface_density, emoji_style, time_format, date_format, language, gif_autoplay,
           link_preview, code_theme, message_grouping_minutes, avatar_shape, streamer_mode,
           quiet_hours_enabled, quiet_hours_start, quiet_hours_end,
           reduce_motion, high_contrast, glassmorphism, show_role_colors,
           show_member_list_default, sidebar_width_px, pronouns,
           show_timestamps, message_display, colorblind_mode,
           dm_from_all, show_online, activity_visibility, friend_request_from, explicit_content_filter,
           updated_at
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
           $17, $18, $19, $20::TIME, $21::TIME, $22, $23, $24, $25, $26, $27, $28,
           $29, $30, $31, $32, $33, $34, $35, $36, NOW()
         )
         ON CONFLICT (user_id) DO UPDATE SET
           font_family = COALESCE($2, user_settings.font_family),
           font_size_px = COALESCE($3, user_settings.font_size_px),
           font_color = $4,
           accent_color = $5,
           bg_color = $6,
           bg_image_url = $7,
           interface_density = COALESCE($8, user_settings.interface_density),
           emoji_style = COALESCE($9, user_settings.emoji_style),
           time_format = COALESCE($10, user_settings.time_format),
           date_format = COALESCE($11, user_settings.date_format),
           language = COALESCE($12, user_settings.language),
           gif_autoplay = COALESCE($13, user_settings.gif_autoplay),
           link_preview = COALESCE($14, user_settings.link_preview),
           code_theme = COALESCE($15, user_settings.code_theme),
           message_grouping_minutes = COALESCE($16, user_settings.message_grouping_minutes),
           avatar_shape = COALESCE($17, user_settings.avatar_shape),
           streamer_mode = COALESCE($18, user_settings.streamer_mode),
           quiet_hours_enabled = COALESCE($19, user_settings.quiet_hours_enabled),
           quiet_hours_start = COALESCE($20::TIME, user_settings.quiet_hours_start),
           quiet_hours_end = COALESCE($21::TIME, user_settings.quiet_hours_end),
           reduce_motion = COALESCE($22, user_settings.reduce_motion),
           high_contrast = COALESCE($23, user_settings.high_contrast),
           glassmorphism = COALESCE($24, user_settings.glassmorphism),
           show_role_colors = COALESCE($25, user_settings.show_role_colors),
           show_member_list_default = COALESCE($26, user_settings.show_member_list_default),
           sidebar_width_px = COALESCE($27, user_settings.sidebar_width_px),
           pronouns = $28,
           show_timestamps = COALESCE($29, user_settings.show_timestamps),
           message_display = COALESCE($30, user_settings.message_display),
           colorblind_mode = COALESCE($31, user_settings.colorblind_mode),
           dm_from_all = COALESCE($32, user_settings.dm_from_all),
           show_online = COALESCE($33, user_settings.show_online),
           activity_visibility = COALESCE($34, user_settings.activity_visibility),
           friend_request_from = COALESCE($35, user_settings.friend_request_from),
           explicit_content_filter = COALESCE($36, user_settings.explicit_content_filter),
           updated_at = NOW()"
    )
    .bind(claims.sub)
    .bind(body.font_family.as_deref().unwrap_or("Inter"))
    .bind(body.font_size_px.unwrap_or(14))
    .bind(font_color.as_deref())
    .bind(accent_color.as_deref())
    .bind(bg_color.as_deref())
    .bind(bg_image_url.as_deref())
    .bind(body.interface_density.as_deref().unwrap_or("normal"))
    .bind(body.emoji_style.as_deref().unwrap_or("native"))
    .bind(body.time_format.as_deref().unwrap_or("24h"))
    .bind(body.date_format.as_deref().unwrap_or("DD/MM/YYYY"))
    .bind(body.language.as_deref().unwrap_or("fr"))
    .bind(body.gif_autoplay.as_deref().unwrap_or("always"))
    .bind(body.link_preview.unwrap_or(true))
    .bind(body.code_theme.as_deref().unwrap_or("dracula"))
    .bind(body.message_grouping_minutes.unwrap_or(5))
    .bind(body.avatar_shape.as_deref().unwrap_or("round"))
    .bind(body.streamer_mode.unwrap_or(false))
    .bind(body.quiet_hours_enabled.unwrap_or(false))
    .bind(quiet_hours_start.as_deref())
    .bind(quiet_hours_end.as_deref())
    .bind(body.reduce_motion.unwrap_or(false))
    .bind(body.high_contrast.unwrap_or(false))
    .bind(body.glassmorphism.unwrap_or(false))
    .bind(body.show_role_colors.unwrap_or(true))
    .bind(body.show_member_list_default.unwrap_or(true))
    .bind(body.sidebar_width_px.unwrap_or(240))
    .bind(pronouns.as_deref())
    .bind(body.show_timestamps.as_deref().unwrap_or("hover"))
    .bind(body.message_display.as_deref().unwrap_or("normal"))
    .bind(body.colorblind_mode.as_deref().unwrap_or("none"))
    .bind(body.dm_from_all.unwrap_or(true))
    .bind(body.show_online.unwrap_or(true))
    .bind(body.activity_visibility.as_deref().unwrap_or("everyone"))
    .bind(body.friend_request_from.as_deref().unwrap_or("everyone"))
    .bind(body.explicit_content_filter.as_deref().unwrap_or("none"))
    .execute(&state.db)
    .await?;

    get_user_settings(Extension(claims), State(state)).await
}

// ─── Connected Accounts ───────────────────────────────────────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ConnectedAccount {
    pub id: Uuid,
    pub platform: String,
    pub platform_username: String,
    pub platform_url: Option<String>,
    pub verified: bool,
}

#[derive(Debug, Deserialize)]
pub struct AddConnectedAccount {
    pub platform: String,
    pub platform_username: String,
    pub platform_url: Option<String>,
}

const ALLOWED_PLATFORMS: &[&str] = &[
    "github", "twitter", "steam", "spotify", "youtube",
    "twitch", "linkedin", "reddit", "instagram", "tiktok",
];

pub async fn list_connected_accounts(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
) -> Result<Json<Vec<ConnectedAccount>>> {
    let accounts = sqlx::query_as::<_, ConnectedAccount>(
        "SELECT id, platform, platform_username, platform_url, verified
         FROM connected_accounts WHERE user_id = $1 ORDER BY created_at"
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(accounts))
}

pub async fn add_connected_account(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Json(body): Json<AddConnectedAccount>,
) -> Result<Json<ConnectedAccount>> {
    if !ALLOWED_PLATFORMS.contains(&body.platform.as_str()) {
        return Err(AppError::BadRequest("Plateforme non supportée".into()));
    }
    if body.platform_username.trim().is_empty() {
        return Err(AppError::BadRequest("Nom d'utilisateur requis".into()));
    }
    let acc = sqlx::query_as::<_, ConnectedAccount>(
        "INSERT INTO connected_accounts (user_id, platform, platform_username, platform_url)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, platform) DO UPDATE SET
           platform_username = EXCLUDED.platform_username,
           platform_url = EXCLUDED.platform_url,
           verified = FALSE
         RETURNING id, platform, platform_username, platform_url, verified"
    )
    .bind(claims.sub)
    .bind(&body.platform)
    .bind(body.platform_username.trim())
    .bind(body.platform_url.as_deref())
    .fetch_one(&state.db)
    .await?;
    Ok(Json(acc))
}

pub async fn delete_connected_account(
    Extension(claims): Extension<Claims>,
    Path(platform): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>> {
    sqlx::query(
        "DELETE FROM connected_accounts WHERE user_id = $1 AND platform = $2"
    )
    .bind(claims.sub)
    .bind(&platform)
    .execute(&state.db)
    .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ─── Notification Overrides ───────────────────────────────────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ServerNotifOverride {
    pub id: Uuid,
    pub server_id: Uuid,
    pub level: String,
    pub muted: bool,
}

pub async fn get_notification_overrides(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
) -> Result<Json<Vec<ServerNotifOverride>>> {
    let rows = sqlx::query_as::<_, ServerNotifOverride>(
        "SELECT id, server_id, level, muted
         FROM notification_overrides_server WHERE user_id = $1 ORDER BY id"
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows))
}

#[derive(Debug, Deserialize)]
pub struct SetNotifOverride {
    pub server_id: Uuid,
    pub level: String,
    pub muted: bool,
}

pub async fn set_notification_override(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Json(body): Json<SetNotifOverride>,
) -> Result<Json<serde_json::Value>> {
    if !["all", "mentions", "nothing", "inherit"].contains(&body.level.as_str()) {
        return Err(AppError::BadRequest("level invalide".into()));
    }
    sqlx::query(
        "INSERT INTO notification_overrides_server (user_id, server_id, level, muted)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, server_id) DO UPDATE SET level = EXCLUDED.level, muted = EXCLUDED.muted"
    )
    .bind(claims.sub)
    .bind(body.server_id)
    .bind(&body.level)
    .bind(body.muted)
    .execute(&state.db)
    .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ─── Keybindings ──────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct Keybinding {
    pub action: String,
    pub key_combo: String,
}

pub async fn get_keybindings(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
) -> Result<Json<Vec<Keybinding>>> {
    let rows = sqlx::query_as::<_, Keybinding>(
        "SELECT action, key_combo FROM user_keybindings WHERE user_id = $1 ORDER BY action"
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows))
}

pub async fn set_keybinding(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Json(body): Json<Keybinding>,
) -> Result<Json<serde_json::Value>> {
    if body.action.trim().is_empty() || body.key_combo.trim().is_empty() {
        return Err(AppError::BadRequest("action et key_combo requis".into()));
    }
    sqlx::query(
        "INSERT INTO user_keybindings (user_id, action, key_combo)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, action) DO UPDATE SET key_combo = EXCLUDED.key_combo"
    )
    .bind(claims.sub)
    .bind(&body.action)
    .bind(&body.key_combo)
    .execute(&state.db)
    .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn reset_keybinding(
    Extension(claims): Extension<Claims>,
    Path(action): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>> {
    sqlx::query(
        "DELETE FROM user_keybindings WHERE user_id = $1 AND action = $2"
    )
    .bind(claims.sub)
    .bind(&action)
    .execute(&state.db)
    .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
