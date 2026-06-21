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
    pub frontend_url: String,
    // SMTP (optionnel — si absent, les emails sont loggés en console)
    pub smtp_host: Option<String>,
    pub smtp_port: u16,
    pub smtp_user: Option<String>,
    pub smtp_pass: Option<String>,
    pub smtp_from: String,
    // TURN (optionnel — si absent, STUN seulement)
    pub turn_url: Option<String>,
    pub turn_username: Option<String>,
    pub turn_password: Option<String>,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        dotenvy::dotenv().ok();
        Ok(Self {
            database_url: env::var("DATABASE_URL")?,
            redis_url: env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into()),
            jwt_secret: env::var("JWT_SECRET")?,
            jwt_issuer: env::var("JWT_ISSUER").unwrap_or_else(|_| "forgechat".into()),
            port: env::var("PORT")
                .unwrap_or_else(|_| "8080".into())
                .parse()?,
            upload_dir: env::var("UPLOAD_DIR").unwrap_or_else(|_| "./uploads".into()),
            max_upload_size: env::var("MAX_UPLOAD_SIZE")
                .unwrap_or_else(|_| "52428800".into())
                .parse()?,
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
            turn_url: env::var("TURN_URL").ok(),
            turn_username: env::var("TURN_USERNAME").ok(),
            turn_password: env::var("TURN_PASSWORD").ok(),
        })
    }
}
