//! Clé de récupération d'un serveur (docs/CHIFFREMENT-E2E.md §11).
//!
//! L'appli du propriétaire génère une paire ECDH P-256 « clé de serveur ». La
//! plateforme ne garde que la clé publique et deux enveloppes opaques de la clé
//! privée : l'une ouverte par le code de récupération du serveur, l'autre par la
//! clé de compte du propriétaire. Chaque époque de salon est aussi enveloppée
//! pour la clé publique du serveur : le propriétaire peut tout relire (salons
//! privés compris), la plateforme rien. Les MP et groupes ne sont pas concernés.

use axum::{
    extract::{Path, State},
    Extension, Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::{e2e_conv::KeyWrap, user_keys::{public_fingerprint, Wrapped}},
    middleware::auth::Claims,
    state::AppState,
};

async fn owner_of(db: &PgPool, server_id: Uuid) -> Result<Uuid> {
    sqlx::query_scalar("SELECT owner_id FROM servers WHERE id=$1")
        .bind(server_id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Serveur introuvable".into()))
}

async fn require_owner(db: &PgPool, server_id: Uuid, user: Uuid) -> Result<()> {
    if owner_of(db, server_id).await? != user {
        return Err(AppError::Forbidden);
    }
    Ok(())
}

/// Texte signé par le propriétaire : lie la clé publique du serveur au serveur et au signataire.
pub fn signed_text(server_id: Uuid, signer: Uuid, public: &str) -> String {
    format!("forgechat server-key sig v1|{server_id}|{signer}|{public}")
}

/// Vérifie la signature ECDSA P-256 (SHA-256, r ‖ s en base64url) de `signer_public` (clé de
/// compte, point non compressé en base64url) sur `signed_text`. Le serveur la contrôle aussi
/// (défense en profondeur) ; ce sont les applis qui la vérifient contre la clé ÉPINGLÉE du signataire.
pub fn check_signature(server_id: Uuid, signer: Uuid, public: &str, signer_public: &str, signature: &str) -> bool {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    use p256::ecdsa::{signature::Verifier, Signature, VerifyingKey};
    let (Ok(sig), Ok(key)) = (URL_SAFE_NO_PAD.decode(signature), URL_SAFE_NO_PAD.decode(signer_public)) else { return false };
    let (Ok(sig), Ok(key)) = (Signature::from_slice(&sig), VerifyingKey::from_sec1_bytes(&key)) else { return false };
    key.verify(signed_text(server_id, signer, public).as_bytes(), &sig).is_ok()
}

/// Signature du propriétaire, refusée si elle ne se vérifie pas avec sa clé de compte actuelle.
async fn validated_signature(db: &PgPool, server_id: Uuid, signer: Uuid, public: &str, signature: &str) -> Result<()> {
    if signature.len() > 128 {
        return Err(AppError::BadRequest("Signature invalide".into()));
    }
    let signer_public: Option<String> = sqlx::query_scalar("SELECT public_key FROM user_keys WHERE user_id=$1")
        .bind(signer)
        .fetch_optional(db)
        .await?;
    match signer_public {
        Some(k) if check_signature(server_id, signer, public, &k, signature) => Ok(()),
        _ => Err(AppError::BadRequest("SERVER_KEY_SIGNATURE_INVALID".into())),
    }
}

fn wrapped_json(w: &Wrapped) -> Value {
    json!({ "v": w.v, "salt": w.salt, "iv": w.iv, "ct": w.ct })
}

/// Clé du serveur vue par `user` : la partie publique pour tout membre, les
/// enveloppes de la clé privée pour le propriétaire seulement.
pub async fn read_server_key(db: &PgPool, server_id: Uuid, user: Uuid) -> Result<Value> {
    let member: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id=$1 AND user_id=$2)")
        .bind(server_id)
        .bind(user)
        .fetch_one(db)
        .await?;
    if !member {
        return Err(AppError::Forbidden);
    }
    type Row = (String, String, Value, Option<Uuid>, Option<Value>, Option<String>, Option<Uuid>);
    let row: Option<Row> = sqlx::query_as(
        "SELECT public_key, fingerprint, recovery, owner_id, owner_wrapped, signature, signed_by FROM server_keys WHERE server_id=$1",
    )
    .bind(server_id)
    .fetch_optional(db)
    .await?;
    let Some((public, fingerprint, recovery, wrapped_for, owner_wrapped, signature, signed_by)) = row else {
        return Ok(json!({ "exists": false }));
    };
    let mut out = json!({
        "exists": true, "public": public, "fingerprint": fingerprint, "signature": signature, "signed_by": signed_by,
    });
    if owner_of(db, server_id).await? == user {
        out["recovery"] = recovery;
        // Enveloppe faite pour un ancien propriétaire : inutilisable, le code est demandé.
        out["owner_wrapped"] = if wrapped_for == Some(user) { owner_wrapped.unwrap_or(Value::Null) } else { Value::Null };
    }
    Ok(out)
}

/// GET /servers/:server_id/e2e/server-key
pub async fn get_server_key(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Value>> {
    Ok(Json(read_server_key(&state.db, server_id, claims.sub).await?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateServerKey {
    public: String,
    recovery: Wrapped,
    owner_wrapped: KeyWrap,
    /// Signature du propriétaire (applis à jour) ; absente : clé non signée, acceptée explicitement par chacun.
    #[serde(default)]
    signature: Option<String>,
}

pub async fn create_key(db: &PgPool, server_id: Uuid, user: Uuid, body: &CreateServerKey) -> Result<String> {
    require_owner(db, server_id, user).await?;
    body.recovery.validate()?;
    body.owner_wrapped.validate()?;
    let fp = public_fingerprint(&body.public)?;
    if let Some(sig) = &body.signature {
        validated_signature(db, server_id, user, &body.public, sig).await?;
    }
    let done = sqlx::query(
        "INSERT INTO server_keys (server_id, public_key, fingerprint, recovery, owner_id, owner_wrapped, signature, signed_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (server_id) DO NOTHING",
    )
    .bind(server_id)
    .bind(&body.public)
    .bind(&fp)
    .bind(wrapped_json(&body.recovery))
    .bind(user)
    .bind(body.owner_wrapped.to_json())
    .bind(&body.signature)
    .bind(body.signature.as_ref().map(|_| user))
    .execute(db)
    .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::Conflict("SERVER_KEY_EXISTS".into()));
    }
    Ok(fp)
}

/// PUT /servers/:server_id/e2e/server-key — création seulement (409 SERVER_KEY_EXISTS).
pub async fn put_server_key(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<CreateServerKey>,
) -> Result<Json<Value>> {
    let fp = create_key(&state.db, server_id, claims.sub, &body).await?;
    // Les membres en ligne enveloppent pour elle les époques qu'ils connaissent.
    state
        .broadcast_to_server_members(server_id, json!({ "type": "SERVER_KEY", "server_id": server_id }).to_string())
        .await;
    Ok(Json(json!({ "ok": true, "fingerprint": fp })))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecoveryBody {
    recovery: Wrapped,
}

/// PUT /servers/:server_id/e2e/server-key/recovery — nouveau code (même clé).
pub async fn put_recovery(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<RecoveryBody>,
) -> Result<Json<Value>> {
    require_owner(&state.db, server_id, claims.sub).await?;
    body.recovery.validate()?;
    let done = sqlx::query("UPDATE server_keys SET recovery=$2, updated_at=NOW() WHERE server_id=$1")
        .bind(server_id)
        .bind(wrapped_json(&body.recovery))
        .execute(&state.db)
        .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::NotFound("NO_SERVER_KEY".into()));
    }
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OwnerBody {
    owner_wrapped: KeyWrap,
}

/// PUT /servers/:server_id/e2e/server-key/owner — le propriétaire (nouveau, ou
/// qui a changé de clé de compte) ré-enveloppe la clé du serveur pour lui.
pub async fn put_owner_wrapped(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<OwnerBody>,
) -> Result<Json<Value>> {
    require_owner(&state.db, server_id, claims.sub).await?;
    body.owner_wrapped.validate()?;
    let done = sqlx::query("UPDATE server_keys SET owner_id=$2, owner_wrapped=$3, updated_at=NOW() WHERE server_id=$1")
        .bind(server_id)
        .bind(claims.sub)
        .bind(body.owner_wrapped.to_json())
        .execute(&state.db)
        .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::NotFound("NO_SERVER_KEY".into()));
    }
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignatureBody {
    signature: String,
}

/// PUT /servers/:server_id/e2e/server-key/signature — le propriétaire (actuel) signe la clé
/// existante : clé créée avant les signatures, ou après un transfert de propriété.
pub async fn put_signature(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<SignatureBody>,
) -> Result<Json<Value>> {
    require_owner(&state.db, server_id, claims.sub).await?;
    let public: String = sqlx::query_scalar("SELECT public_key FROM server_keys WHERE server_id=$1")
        .bind(server_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("NO_SERVER_KEY".into()))?;
    validated_signature(&state.db, server_id, claims.sub, &public, &body.signature).await?;
    sqlx::query("UPDATE server_keys SET signature=$2, signed_by=$3, updated_at=NOW() WHERE server_id=$1")
        .bind(server_id)
        .bind(&body.signature)
        .bind(claims.sub)
        .execute(&state.db)
        .await?;
    Ok(Json(json!({ "ok": true })))
}

/// Toutes les enveloppes d'époques pour la clé du serveur, par salon (propriétaire seulement).
pub async fn recovery_envelopes(db: &PgPool, server_id: Uuid, user: Uuid) -> Result<Value> {
    require_owner(db, server_id, user).await?;
    type Row = (Uuid, String, String, i32, Value, Option<Uuid>, String);
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT c.id, c.name, c.type, s.epoch, s.wrapped, s.wrapped_by, s.wrapped_by_pub
         FROM server_epoch_keys s JOIN channels c ON c.id = s.channel_id
         JOIN server_keys k ON k.server_id = c.server_id AND k.fingerprint = s.server_fp
         WHERE c.server_id = $1 ORDER BY c.position, c.id, s.epoch",
    )
    .bind(server_id)
    .fetch_all(db)
    .await?;
    let mut channels: Vec<Value> = Vec::new();
    for (id, name, kind, epoch, wrapped, by, by_pub) in rows {
        let env = json!({ "epoch": epoch, "wrapped": wrapped, "wrapped_by": by, "wrapped_by_pub": by_pub });
        match channels.last_mut() {
            Some(c) if c["channel_id"] == json!(id) => c["epochs"].as_array_mut().into_iter().for_each(|a| a.push(env.clone())),
            _ => channels.push(json!({ "channel_id": id, "name": name, "type": kind, "epochs": [env] })),
        }
    }
    Ok(json!({ "channels": channels }))
}

/// GET /servers/:server_id/e2e/recovery
pub async fn get_recovery(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Value>> {
    Ok(Json(recovery_envelopes(&state.db, server_id, claims.sub).await?))
}

/// Transfert de propriété : l'enveloppe du propriétaire suit (`wrapped` fait par
/// l'ancien propriétaire pour le nouveau), sinon le nouveau saisira le code.
pub async fn transfer(tx: &mut Transaction<'_, Postgres>, server_id: Uuid, new_owner: Uuid, wrapped: Option<&Value>) -> Result<()> {
    let wrapped = match wrapped.filter(|v| !v.is_null()) {
        Some(v) => {
            let w: KeyWrap = serde_json::from_value(v.clone()).map_err(|_| AppError::BadRequest("Enveloppe invalide".into()))?;
            w.validate()?;
            Some(w.to_json())
        }
        None => None,
    };
    sqlx::query("UPDATE server_keys SET owner_id=$2, owner_wrapped=$3, updated_at=NOW() WHERE server_id=$1")
        .bind(server_id)
        .bind(new_owner)
        .bind(wrapped)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    use p256::ecdsa::{signature::Signer, Signature, SigningKey};

    /// Signature faite par le navigateur (WebCrypto), vecteur `serverKeySig` de docs/e2e-vectors.json.
    #[test]
    fn webcrypto_signature_vector() {
        let v: Value = serde_json::from_str(include_str!("../../../docs/e2e-vectors.json")).unwrap();
        let v = &v["serverKeySig"];
        let s = |k: &str| v[k].as_str().unwrap().to_string();
        let (server, signer) = (s("server_id").parse().unwrap(), s("signed_by").parse().unwrap());
        assert!(check_signature(server, signer, &s("public"), &s("signer_public"), &s("signature")));
        // WebCrypto ne normalise pas S : la forme « S haut » (n - s) doit passer aussi.
        assert!(check_signature(server, signer, &s("public"), &s("signer_public"), &s("signature_high_s")));
        assert!(!check_signature(server, Uuid::new_v4(), &s("public"), &s("signer_public"), &s("signature")));
    }

    #[test]
    fn owner_signature_rules() {
        let sk = SigningKey::from_slice(&[7u8; 32]).unwrap();
        let signer_pub = URL_SAFE_NO_PAD.encode(sk.verifying_key().to_encoded_point(false).as_bytes());
        let (server, owner) = (Uuid::new_v4(), Uuid::new_v4());
        let public = "BFAKE";
        let sig: Signature = sk.sign(signed_text(server, owner, public).as_bytes());
        let sig = URL_SAFE_NO_PAD.encode(sig.to_bytes());
        assert!(check_signature(server, owner, public, &signer_pub, &sig));
        // Autre clé publique, autre serveur, autre signataire, signature altérée : refus.
        assert!(!check_signature(server, owner, "BAUTRE", &signer_pub, &sig));
        assert!(!check_signature(Uuid::new_v4(), owner, public, &signer_pub, &sig));
        assert!(!check_signature(server, Uuid::new_v4(), public, &signer_pub, &sig));
        assert!(!check_signature(server, owner, public, &signer_pub, &sig.replace('A', "B")));
        assert!(!check_signature(server, owner, public, &signer_pub, "pas une signature"));
    }

    /// Contre un vrai PostgreSQL (ignoré par défaut) :
    /// `FORGECHAT_TEST_DATABASE_URL=… cargo test -- --ignored server_key_signature_db`
    #[tokio::test]
    #[ignore]
    async fn server_key_signature_db() {
        let db_url = std::env::var("FORGECHAT_TEST_DATABASE_URL").expect("FORGECHAT_TEST_DATABASE_URL");
        let db = PgPool::connect(&db_url).await.expect("db");
        sqlx::migrate!("./migrations").run(&db).await.expect("migrations");
        let user = |db: PgPool| async move {
            let tag = Uuid::new_v4().simple().to_string();
            sqlx::query_scalar::<_, Uuid>("INSERT INTO users (username, email, password_hash) VALUES ($1, $2, 'x') RETURNING id")
                .bind(&tag[..20]).bind(format!("{tag}@test.local")).fetch_one(&db).await.unwrap()
        };
        let (owner, other) = (user(db.clone()).await, user(db.clone()).await);
        let sk = SigningKey::from_slice(&[9u8; 32]).unwrap();
        let owner_pub = URL_SAFE_NO_PAD.encode(sk.verifying_key().to_encoded_point(false).as_bytes());
        sqlx::query("INSERT INTO user_keys (user_id, public_key, fingerprint, wrapped) VALUES ($1, $2, 'fp', '{}')")
            .bind(owner).bind(&owner_pub).execute(&db).await.unwrap();
        let server: Uuid = sqlx::query_scalar("INSERT INTO servers (name, owner_id) VALUES ('signe', $1) RETURNING id")
            .bind(owner).fetch_one(&db).await.unwrap();
        let server_pub = URL_SAFE_NO_PAD.encode(SigningKey::from_slice(&[3u8; 32]).unwrap().verifying_key().to_encoded_point(false).as_bytes());
        let sign = |signer: Uuid| -> String {
            let sig: Signature = sk.sign(signed_text(server, signer, &server_pub).as_bytes());
            URL_SAFE_NO_PAD.encode(sig.to_bytes())
        };
        let body = |signature: Option<String>| -> CreateServerKey {
            serde_json::from_value(json!({
                "public": server_pub,
                "recovery": { "v": 1, "salt": URL_SAFE_NO_PAD.encode([1u8; 16]), "iv": URL_SAFE_NO_PAD.encode([2u8; 12]), "ct": URL_SAFE_NO_PAD.encode([3u8; 48]) },
                "owner_wrapped": { "v": 1, "iv": URL_SAFE_NO_PAD.encode([2u8; 12]), "ct": URL_SAFE_NO_PAD.encode([3u8; 48]) },
                "signature": signature,
            })).unwrap()
        };
        // Signature faite pour un autre signataire : refusée, rien n'est créé.
        assert!(create_key(&db, server, owner, &body(Some(sign(other)))).await.is_err());
        // Non-propriétaire : refusé.
        assert!(create_key(&db, server, other, &body(Some(sign(other)))).await.is_err());
        // Propriétaire, signature valide : créée, signée, rendue aux membres.
        create_key(&db, server, owner, &body(Some(sign(owner)))).await.expect("création signée");
        sqlx::query("INSERT INTO server_members (user_id, server_id, is_owner) VALUES ($1, $2, TRUE), ($3, $2, FALSE)")
            .bind(owner).bind(server).bind(other).execute(&db).await.unwrap();
        let seen = read_server_key(&db, server, other).await.unwrap();
        assert_eq!(seen["signed_by"], json!(owner));
        assert!(check_signature(server, owner, &server_pub, &owner_pub, seen["signature"].as_str().unwrap()));
        assert!(seen.get("recovery").is_none(), "enveloppes réservées au propriétaire");
        // Signature après coup : seule une signature valide du propriétaire est acceptée.
        assert!(validated_signature(&db, server, owner, &server_pub, &sign(other)).await.is_err());
        assert!(validated_signature(&db, server, owner, &server_pub, &sign(owner)).await.is_ok());
    }
}

