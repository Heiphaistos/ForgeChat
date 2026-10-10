//! HS256 seul pour `jsonwebtoken` (jetons de session, LiveKit) : fournisseur de chiffrement
//! maison sur `hmac`/`sha2`, à la place de la fonctionnalité `rust_crypto` qui tirait la crate
//! `rsa` (RUSTSEC-2023-0071, jamais utilisée ici). Tout autre algorithme est refusé.
use jsonwebtoken::{
    crypto::{CryptoProvider, JwkUtils, JwtSigner, JwtVerifier},
    errors::{ErrorKind, Result},
    signature::{self, Signer, Verifier},
    Algorithm, DecodingKey, EncodingKey,
};
use hmac::Mac;

use crate::crypto::HmacSha256;

struct Hs256(HmacSha256);

impl Hs256 {
    fn new(alg: &Algorithm, secret: Result<&[u8]>) -> Result<Self> {
        if *alg != Algorithm::HS256 {
            return Err(ErrorKind::InvalidAlgorithm.into());
        }
        Ok(Self(HmacSha256::new_from_slice(secret?).map_err(|_| ErrorKind::InvalidKeyFormat)?))
    }
}

impl Signer<Vec<u8>> for Hs256 {
    fn try_sign(&self, msg: &[u8]) -> std::result::Result<Vec<u8>, signature::Error> {
        let mut m = self.0.clone();
        m.update(msg);
        Ok(m.finalize().into_bytes().to_vec())
    }
}

impl Verifier<Vec<u8>> for Hs256 {
    fn verify(&self, msg: &[u8], sig: &Vec<u8>) -> std::result::Result<(), signature::Error> {
        let mut m = self.0.clone();
        m.update(msg);
        m.verify_slice(sig).map_err(signature::Error::from_source)
    }
}

impl JwtSigner for Hs256 {
    fn algorithm(&self) -> Algorithm {
        Algorithm::HS256
    }
}

impl JwtVerifier for Hs256 {
    fn algorithm(&self) -> Algorithm {
        Algorithm::HS256
    }
}

static PROVIDER: CryptoProvider = CryptoProvider {
    signer_factory: |alg, key: &EncodingKey| Ok(Box::new(Hs256::new(alg, key.try_get_hmac_secret())?)),
    verifier_factory: |alg, key: &DecodingKey| Ok(Box::new(Hs256::new(alg, key.try_get_hmac_secret())?)),
    jwk_utils: JwkUtils::new_unimplemented(),
};

/// À appeler avant tout `jsonwebtoken::encode` / `decode` (idempotent, sans coût après le 1er appel).
pub fn ready() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let _ = PROVIDER.install_default();
    });
}

#[cfg(test)]
mod tests {
    use jsonwebtoken::{decode, encode, Header, Validation};

    #[test]
    fn hs256_only() {
        super::ready();
        let claims = serde_json::json!({ "sub": "x", "exp": 4_000_000_000u64 });
        let tok = encode(&Header::default(), &claims, &super::EncodingKey::from_secret(b"k")).unwrap();
        let ok = decode::<serde_json::Value>(&tok, &super::DecodingKey::from_secret(b"k"), &Validation::default());
        assert_eq!(ok.unwrap().claims["sub"], "x");
        assert!(decode::<serde_json::Value>(&tok, &super::DecodingKey::from_secret(b"autre"), &Validation::default()).is_err());
        // Jeton annonçant un autre algorithme : refusé avant toute vérification.
        assert!(encode(&Header::new(super::Algorithm::HS512), &claims, &super::EncodingKey::from_secret(b"k")).is_err());
        let mut v = Validation::new(super::Algorithm::HS384);
        v.algorithms = vec![super::Algorithm::HS384];
        assert!(decode::<serde_json::Value>(&tok, &super::DecodingKey::from_secret(b"k"), &v).is_err());
    }
}
