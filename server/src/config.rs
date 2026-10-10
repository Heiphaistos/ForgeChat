use std::env;

#[derive(Clone, Debug)]
pub struct Config {
    pub database_url: String,
    pub redis_url: String,
    pub jwt_secret: String,
    pub jwt_issuer: String,
    pub port: u16,
    pub upload_dir: String,
    pub max_upload_size: u64,
    /// Stockage total de pièces jointes par compte, en octets (UPLOAD_QUOTA_BYTES, 5 Gio par défaut).
    pub upload_quota_bytes: u64,
    /// Requêtes d'envoi de fichiers par compte et par minute (UPLOAD_RATE_PER_MINUTE, 20 par défaut).
    pub upload_rate_per_minute: i64,
    pub frontend_url: String,
    // SMTP (optionnel — si absent, les emails sont loggés en console)
    pub smtp_host: Option<String>,
    pub smtp_port: u16,
    pub smtp_user: Option<String>,
    pub smtp_pass: Option<String>,
    pub smtp_from: String,
    // TURN (optionnel — si absent, STUN seulement)
    /// STUN_URLS (séparés par des virgules). Aucun STUN public par défaut.
    pub stun_urls: Vec<String>,
    pub turn_url: Option<String>,
    /// Secret partagé coturn (`static-auth-secret`) pour les credentials éphémères
    /// (TURN REST API). Seul mode TURN : sans lui, pas de relais.
    pub turn_static_auth_secret: Option<String>,
    /// Origine autorisée des ZIP d'import Discord (anti-SSRF).
    pub archiveforge_url: String,
    /// Taille maximale d'un ZIP d'import Discord, en octets.
    pub discord_import_max_bytes: u64,
    /// Dossier des ZIP d'import en cours de traitement (hors du dossier servi /uploads).
    pub discord_import_tmp_dir: String,
}

/// Valeur d'exemple de server/.env.example : jamais acceptée.
const EXAMPLE_JWT_SECRET: &str = "change_me_to_a_very_long_random_secret_key_at_least_64_chars";

/// JWT_SECRET d'au moins 32 octets, différent de l'exemple : sinon le serveur ne démarre pas
/// (avant : une valeur courte ou copiée de l'exemple permettait de forger des jetons).
fn check_jwt_secret(secret: String) -> anyhow::Result<String> {
    let t = secret.trim();
    if t.len() < 32 {
        anyhow::bail!("JWT_SECRET trop court ({} octets, 32 minimum) : générez-en un avec `openssl rand -base64 48`", t.len());
    }
    if t == EXAMPLE_JWT_SECRET || t.starts_with("change_me") {
        anyhow::bail!("JWT_SECRET est la valeur d'exemple de .env.example : générez-en un avec `openssl rand -base64 48`");
    }
    Ok(secret)
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        dotenvy::dotenv().ok();
        Ok(Self {
            database_url: env::var("DATABASE_URL")?,
            redis_url: env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into()),
            jwt_secret: check_jwt_secret(env::var("JWT_SECRET")?)?,
            jwt_issuer: env::var("JWT_ISSUER").unwrap_or_else(|_| "forgechat".into()),
            port: env::var("PORT")
                .unwrap_or_else(|_| "8080".into())
                .parse()?,
            upload_dir: env::var("UPLOAD_DIR").unwrap_or_else(|_| "./uploads".into()),
            max_upload_size: env::var("MAX_UPLOAD_SIZE")
                .unwrap_or_else(|_| "524288000".into()) // 500 Mo par fichier (gratuit)
                .parse()?,
            upload_quota_bytes: env::var("UPLOAD_QUOTA_BYTES")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(5 * 1024 * 1024 * 1024),
            upload_rate_per_minute: env::var("UPLOAD_RATE_PER_MINUTE")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(20),
            frontend_url: env::var("FRONTEND_URL")
                .unwrap_or_else(|_| "http://localhost:5173".into()),
            smtp_host: env::var("SMTP_HOST").ok(),
            smtp_port: env::var("SMTP_PORT")
                .unwrap_or_else(|_| "587".into())
                .parse()
                .unwrap_or(587),
            smtp_user: env::var("SMTP_USER").ok(),
            smtp_pass: env::var("SMTP_PASS").ok(),
            smtp_from: env::var("SMTP_FROM")
                .unwrap_or_else(|_| "noreply@forgechat.heiphaistos.org".into()),
            stun_urls: crate::handlers::voice::parse_stun_urls(&env::var("STUN_URLS").unwrap_or_default()),
            turn_url: env::var("TURN_URL").ok(),
            turn_static_auth_secret: env::var("TURN_STATIC_AUTH_SECRET").ok(),
            archiveforge_url: env::var("ARCHIVEFORGE_URL")
                .unwrap_or_else(|_| "https://forgearchive.heiphaistos.org".into()),
            discord_import_max_bytes: env::var("DISCORD_IMPORT_MAX_BYTES")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(20 * 1024 * 1024 * 1024),
            discord_import_tmp_dir: env::var("DISCORD_IMPORT_TMP_DIR").unwrap_or_else(|_| {
                std::env::temp_dir().join("forgechat-discord-import").to_string_lossy().into_owned()
            }),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jwt_secret_rules() {
        assert!(check_jwt_secret("court".into()).is_err());
        assert!(check_jwt_secret(EXAMPLE_JWT_SECRET.into()).is_err());
        assert!(check_jwt_secret("x".repeat(31)).is_err());
        assert!(check_jwt_secret("Zq3".repeat(16)).is_ok());
    }
}
