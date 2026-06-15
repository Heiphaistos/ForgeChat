use std::env;

#[derive(Clone, Debug)]
pub struct Config {
    pub database_url: String,
    pub redis_url: String,
    pub jwt_secret: String,
    pub port: u16,
    pub upload_dir: String,
    pub max_upload_size: u64,
    pub frontend_url: String,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        dotenvy::dotenv().ok();
        Ok(Self {
            database_url: env::var("DATABASE_URL")?,
            redis_url: env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into()),
            jwt_secret: env::var("JWT_SECRET")?,
            port: env::var("PORT")
                .unwrap_or_else(|_| "8080".into())
                .parse()?,
            upload_dir: env::var("UPLOAD_DIR").unwrap_or_else(|_| "./uploads".into()),
            max_upload_size: env::var("MAX_UPLOAD_SIZE")
                .unwrap_or_else(|_| "52428800".into())
                .parse()?,
            frontend_url: env::var("FRONTEND_URL")
                .unwrap_or_else(|_| "http://localhost:5173".into()),
        })
    }
}
