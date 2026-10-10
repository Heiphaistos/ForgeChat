//! Adresses e-mail chiffrées au repos (audit 2026-10-10, phase 2).
//!
//! `users.email_hmac` = HMAC-SHA256(clé dérivée, e-mail normalisé) en hexadécimal : recherches
//! exactes et unicité. `users.email_enc` = `v1:` + base64url(iv 12 o ‖ AES-256-GCM), clé
//! EMAIL_ENC_KEY (32 octets base64), AAD `forgechat email v1|<user_id>` : lue seulement pour
//! écrire à l'utilisateur, lui montrer son adresse ou l'exporter. `users.email` reste NULL.
use std::sync::OnceLock;

use aes_gcm::{aead::{Aead, KeyInit, Payload}, Aes256Gcm, Nonce};
use base64::{engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD}, Engine};
use hmac::Mac;
use rand::Rng;
use sqlx::PgPool;
use uuid::Uuid;

use crate::crypto::{hkdf32, HmacSha256};

struct Keys {
    enc: [u8; 32],
    mac: [u8; 32],
}

static KEYS: OnceLock<Keys> = OnceLock::new();
const SEALED: &str = "v1:";

/// Lit EMAIL_ENC_KEY au démarrage ; absente ou invalide = le serveur ne démarre pas.
pub fn init() -> anyhow::Result<()> {
    let raw = std::env::var("EMAIL_ENC_KEY")
        .map_err(|_| anyhow::anyhow!("EMAIL_ENC_KEY manquante : 32 octets en base64 (openssl rand -base64 32)"))?;
    let raw = raw.trim();
    let key = STANDARD.decode(raw).or_else(|_| URL_SAFE_NO_PAD.decode(raw))
        .map_err(|_| anyhow::anyhow!("EMAIL_ENC_KEY invalide : base64 attendu"))?;
    let enc: [u8; 32] = key.try_into().map_err(|_| anyhow::anyhow!("EMAIL_ENC_KEY invalide : 32 octets attendus"))?;
    let _ = KEYS.set(Keys { enc, mac: hkdf32(&enc, b"forgechat email hmac v1") });
    Ok(())
}

fn keys() -> &'static Keys {
    KEYS.get().expect("EMAIL_ENC_KEY chargée au démarrage")
}

pub fn norm(email: &str) -> String {
    email.trim().to_lowercase()
}

/// Empreinte de recherche d'une adresse (normalisée ici).
pub fn hmac(email: &str) -> String {
    let mut m = <HmacSha256 as Mac>::new_from_slice(&keys().mac).expect("hmac");
    m.update(norm(email).as_bytes());
    data_encoding::HEXLOWER.encode(&m.finalize().into_bytes())
}

fn aad(user_id: Uuid) -> String {
    format!("forgechat email v1|{user_id}")
}

pub fn seal(user_id: Uuid, email: &str) -> String {
    let iv: [u8; 12] = rand::thread_rng().gen();
    let ct = Aes256Gcm::new((&keys().enc).into())
        .encrypt(Nonce::from_slice(&iv), Payload { msg: norm(email).as_bytes(), aad: aad(user_id).as_bytes() })
        .expect("AES-GCM");
    format!("{SEALED}{}", URL_SAFE_NO_PAD.encode([&iv[..], &ct].concat()))
}

pub fn open(user_id: Uuid, stored: &str) -> Option<String> {
    let raw = URL_SAFE_NO_PAD.decode(stored.strip_prefix(SEALED)?).ok()?;
    if raw.len() < 12 + 16 {
        return None;
    }
    let (iv, ct) = raw.split_at(12);
    let pt = Aes256Gcm::new((&keys().enc).into())
        .decrypt(Nonce::from_slice(iv), Payload { msg: ct, aad: aad(user_id).as_bytes() })
        .ok()?;
    String::from_utf8(pt).ok()
}

/// Au démarrage : chiffre les adresses encore en clair puis les efface (comptes, inscriptions en
/// attente) ; retire l'adresse du propriétaire de `site_settings`. Idempotent.
pub async fn migrate_at_rest(db: &PgPool) -> anyhow::Result<u64> {
    let rows: Vec<(Uuid, String, bool)> =
        sqlx::query_as("SELECT id, email, is_bot FROM users WHERE email IS NOT NULL").fetch_all(db).await?;
    let mut n = 0;
    for (id, email, is_bot) in rows {
        // Bots et compte « Utilisateur supprimé » : adresse factice, rien à garder.
        let keep = !is_bot && !email.ends_with("@forgechat.invalid");
        let (h, enc) = if keep { (Some(hmac(&email)), Some(seal(id, &email))) } else { (None, None) };
        let done = sqlx::query("UPDATE users SET email_hmac=$2, email_enc=$3, email=NULL WHERE id=$1")
            .bind(id).bind(&h).bind(&enc).execute(db).await;
        if let Err(e) = done {
            // Même adresse à la casse près (comptes très anciens) : chiffrée, mais plus
            // recherchable (elle ne permettait déjà pas de se connecter).
            if !matches!(&e, sqlx::Error::Database(d) if d.is_unique_violation()) {
                return Err(e.into());
            }
            tracing::warn!(user_id = %id, "adresse en double à la casse près : empreinte omise");
            sqlx::query("UPDATE users SET email_hmac=NULL, email_enc=$2, email=NULL WHERE id=$1")
                .bind(id).bind(&enc).execute(db).await?;
        }
        n += 1;
    }
    let pending: Vec<(Uuid, String)> =
        sqlx::query_as("SELECT id, email FROM pending_registrations WHERE email IS NOT NULL").fetch_all(db).await?;
    for (id, email) in pending {
        sqlx::query("UPDATE pending_registrations SET email_hmac=$2, email=NULL WHERE id=$1")
            .bind(id).bind(hmac(&email)).execute(db).await?;
        n += 1;
    }
    sqlx::query("DELETE FROM site_settings WHERE key='owner_email'").execute(db).await?;
    Ok(n)
}

#[cfg(test)]
pub fn init_for_tests() {
    std::env::set_var("EMAIL_ENC_KEY", "CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk=");
    init().expect("EMAIL_ENC_KEY");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seal_open_hmac() {
        init_for_tests();
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        let s = seal(a, " Alice@Example.com ");
        assert!(!s.contains("alice"));
        assert_eq!(open(a, &s).as_deref(), Some("alice@example.com"));
        assert_eq!(open(b, &s), None, "AAD liée au compte");
        assert_ne!(seal(a, "alice@example.com"), seal(a, "alice@example.com"), "IV aléatoire");
        assert_eq!(hmac("ALICE@example.com"), hmac(" alice@example.com"));
        assert_ne!(hmac("alice@example.com"), hmac("bob@example.com"));
        assert_eq!(hmac("x@y.z").len(), 64);
    }
}
