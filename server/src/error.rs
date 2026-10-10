use axum::{http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::json;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Non authentifié")]
    Unauthorized,
    #[error("Accès interdit")]
    Forbidden,
    /// 403 avec un motif lisible (ex. salon protégé du propriétaire).
    #[error("{0}")]
    ForbiddenMsg(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    BadRequest(String),
    #[error("{0}")]
    Conflict(String),
    /// 413 : fichier trop gros ou quota de stockage du compte atteint.
    #[error("{0}")]
    PayloadTooLarge(String),
    #[error("Trop de tentatives — réessayez dans 15 minutes")]
    TooManyRequests,
    /// 429 avec un motif lisible (ex. quota quotidien de super réactions).
    #[error("{0}")]
    TooManyRequestsMsg(String),
    #[error("Mode lent actif — attendez {0} secondes")]
    SlowMode(i64),
    #[error("totp_required")]
    TotpRequired,
    /// 426 : appli trop ancienne pour ce compte (connexion v2), message lisible.
    #[error("{0}")]
    UpgradeRequired(String),
    /// 503 : dépendance indisponible (Redis des compteurs anti-force brute) : on refuse.
    #[error("{0}")]
    Unavailable(String),
    #[error("Erreur interne: {0}")]
    Internal(#[from] anyhow::Error),
    #[error("DB: {0}")]
    Database(#[from] sqlx::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, self.to_string()),
            AppError::Forbidden => (StatusCode::FORBIDDEN, self.to_string()),
            AppError::ForbiddenMsg(m) => (StatusCode::FORBIDDEN, m.clone()),
            AppError::NotFound(m) => (StatusCode::NOT_FOUND, m.clone()),
            AppError::BadRequest(m) => (StatusCode::BAD_REQUEST, m.clone()),
            AppError::Conflict(m) => (StatusCode::CONFLICT, m.clone()),
            AppError::PayloadTooLarge(m) => (StatusCode::PAYLOAD_TOO_LARGE, m.clone()),
            AppError::TooManyRequests => (StatusCode::TOO_MANY_REQUESTS, self.to_string()),
            AppError::TooManyRequestsMsg(m) => (StatusCode::TOO_MANY_REQUESTS, m.clone()),
            AppError::SlowMode(secs) => {
                return (
                    StatusCode::TOO_MANY_REQUESTS,
                    Json(json!({ "error": self.to_string(), "retry_after": secs })),
                ).into_response();
            }
            AppError::TotpRequired => (StatusCode::FORBIDDEN, "totp_required".into()),
            AppError::UpgradeRequired(m) => (StatusCode::UPGRADE_REQUIRED, m.clone()),
            AppError::Unavailable(m) => (StatusCode::SERVICE_UNAVAILABLE, m.clone()),
            AppError::Internal(e) => {
                tracing::error!("Internal error: {e:?}");
                (StatusCode::INTERNAL_SERVER_ERROR, "Erreur serveur".into())
            }
            AppError::Database(e) => {
                // Unique constraint violation → 409 Conflict
                if let sqlx::Error::Database(db_err) = e {
                    if db_err.code().as_deref() == Some("23505") {
                        return (StatusCode::CONFLICT, Json(json!({ "error": "Valeur déjà utilisée" }))).into_response();
                    }
                }
                tracing::error!("DB error: {e:?}");
                (StatusCode::INTERNAL_SERVER_ERROR, "Erreur base de données".into())
            }
        };
        (status, Json(json!({ "error": message }))).into_response()
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
