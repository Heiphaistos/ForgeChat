//! Vérification WebAuthn (clés d'accès / passkeys) — audit 2026-10-12, amélioration n° 3.
//!
//! Second facteur résistant à l'hameçonnage : la signature de l'authentificateur couvre l'origine
//! du site et un défi unique ; une fausse page ne peut ni la produire ni la rejouer.
//!
//! Volontairement minimal et sans dépendance lourde : attestation non vérifiée (`none`, on ne fait
//! pas confiance au modèle de clé, seulement à la possession), algorithme ES256 (P-256, -7) — celui
//! de toutes les clés d'accès Apple, Google, Windows et des clés FIDO2 —, compteur anti-clonage.
//! Les deux fonctions publiques sont pures (aucune base, aucun réseau) et testées avec un
//! authentificateur logiciel en bas de fichier.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ciborium::value::Value;
use p256::ecdsa::{signature::Verifier, Signature, VerifyingKey};
use sha2::{Digest, Sha256};

const FLAG_UP: u8 = 0x01;
const FLAG_AT: u8 = 0x40;
pub const ALG_ES256: i64 = -7;

/// Partie de confiance : identifiant (domaine) et origines acceptées.
pub struct RelyingParty<'a> {
    pub id: &'a str,
    pub origins: &'a [String],
}

/// Clé enregistrée : identifiant de l'authentificateur, clé publique SEC1 non compressée, compteur.
#[derive(Debug, PartialEq)]
pub struct NewCredential {
    pub credential_id: Vec<u8>,
    pub public_key: Vec<u8>,
    pub sign_count: u32,
}

pub fn b64u(data: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(data)
}

pub fn unb64u(s: &str) -> Result<Vec<u8>, &'static str> {
    URL_SAFE_NO_PAD.decode(s.trim_end_matches('=')).map_err(|_| "encodage base64url invalide")
}

fn check_client_data(raw: &[u8], kind: &str, challenge: &str, rp: &RelyingParty) -> Result<(), &'static str> {
    let v: serde_json::Value = serde_json::from_slice(raw).map_err(|_| "clientDataJSON illisible")?;
    if v["type"].as_str() != Some(kind) {
        return Err("type de cérémonie inattendu");
    }
    // Comparaison des octets décodés : le défi est à usage unique et vient de Redis.
    let got = unb64u(v["challenge"].as_str().unwrap_or(""))?;
    let want = unb64u(challenge)?;
    if got.is_empty() || got != want {
        return Err("défi inattendu");
    }
    let origin = v["origin"].as_str().unwrap_or("");
    if !rp.origins.iter().any(|o| o == origin) {
        return Err("origine refusée");
    }
    if v["crossOrigin"].as_bool() == Some(true) {
        return Err("cérémonie dans un cadre d'une autre origine");
    }
    Ok(())
}

fn check_rp_and_flags(auth_data: &[u8], rp: &RelyingParty) -> Result<u8, &'static str> {
    if auth_data.len() < 37 {
        return Err("authenticatorData trop court");
    }
    if auth_data[..32] != Sha256::digest(rp.id.as_bytes())[..] {
        return Err("domaine (rpId) inattendu");
    }
    let flags = auth_data[32];
    if flags & FLAG_UP == 0 {
        return Err("présence de l'utilisateur non confirmée");
    }
    Ok(flags)
}

fn counter(auth_data: &[u8]) -> u32 {
    u32::from_be_bytes([auth_data[33], auth_data[34], auth_data[35], auth_data[36]])
}

fn map_get<'a>(m: &'a [(Value, Value)], key: &Value) -> Option<&'a Value> {
    m.iter().find(|(k, _)| k == key).map(|(_, v)| v)
}

fn int_key(i: i64) -> Value {
    Value::Integer(i.into())
}

/// Clé COSE EC2 P-256 ES256 → SEC1 non compressée (04 ‖ x ‖ y), point vérifié.
fn cose_es256_to_sec1(cose: &Value) -> Result<Vec<u8>, &'static str> {
    let m = cose.as_map().ok_or("clé COSE invalide")?;
    let as_i = |k: i64| map_get(m, &int_key(k)).and_then(|v| v.as_integer()).and_then(|i| i64::try_from(i).ok());
    if as_i(1) != Some(2) || as_i(3) != Some(ALG_ES256) || as_i(-1) != Some(1) {
        return Err("algorithme non pris en charge (ES256 / P-256 seulement)");
    }
    let coord = |k: i64| map_get(m, &int_key(k)).and_then(|v| v.as_bytes()).filter(|b| b.len() == 32);
    let (x, y) = (coord(-2).ok_or("clé COSE invalide")?, coord(-3).ok_or("clé COSE invalide")?);
    let mut sec1 = Vec::with_capacity(65);
    sec1.push(0x04);
    sec1.extend_from_slice(x);
    sec1.extend_from_slice(y);
    VerifyingKey::from_sec1_bytes(&sec1).map_err(|_| "point de courbe invalide")?;
    Ok(sec1)
}

/// Enregistrement (`navigator.credentials.create`) : vérifie la cérémonie et extrait la clé.
pub fn verify_registration(
    client_data_json: &[u8],
    attestation_object: &[u8],
    challenge: &str,
    rp: &RelyingParty,
) -> Result<NewCredential, &'static str> {
    check_client_data(client_data_json, "webauthn.create", challenge, rp)?;
    let att: Value = ciborium::de::from_reader(attestation_object).map_err(|_| "attestationObject illisible")?;
    let m = att.as_map().ok_or("attestationObject illisible")?;
    let auth_data = map_get(m, &Value::Text("authData".into())).and_then(|v| v.as_bytes()).ok_or("authData absent")?;
    let flags = check_rp_and_flags(auth_data, rp)?;
    if flags & FLAG_AT == 0 {
        return Err("aucune clé dans la réponse");
    }
    // aaguid (16) puis longueur de l'identifiant (2), identifiant, clé COSE.
    let rest = auth_data.get(37 + 16..).ok_or("authData tronqué")?;
    if rest.len() < 2 {
        return Err("authData tronqué");
    }
    let len = u16::from_be_bytes([rest[0], rest[1]]) as usize;
    if !(16..=1023).contains(&len) {
        return Err("identifiant de clé invalide");
    }
    let credential_id = rest.get(2..2 + len).ok_or("authData tronqué")?.to_vec();
    let mut cose_bytes = rest.get(2 + len..).ok_or("authData tronqué")?;
    let cose: Value = ciborium::de::from_reader(&mut cose_bytes).map_err(|_| "clé COSE illisible")?;
    let public_key = cose_es256_to_sec1(&cose)?;
    Ok(NewCredential { credential_id, public_key, sign_count: counter(auth_data) })
}

/// Connexion (`navigator.credentials.get`) : vérifie la signature et renvoie le nouveau compteur.
/// Compteur qui ne progresse pas alors que la clé en tient un : clé probablement clonée, refus.
pub fn verify_assertion(
    client_data_json: &[u8],
    authenticator_data: &[u8],
    signature_der: &[u8],
    challenge: &str,
    rp: &RelyingParty,
    public_key_sec1: &[u8],
    stored_count: u32,
) -> Result<u32, &'static str> {
    check_client_data(client_data_json, "webauthn.get", challenge, rp)?;
    check_rp_and_flags(authenticator_data, rp)?;
    let key = VerifyingKey::from_sec1_bytes(public_key_sec1).map_err(|_| "clé enregistrée invalide")?;
    let sig = Signature::from_der(signature_der).map_err(|_| "signature illisible")?;
    // Les authentificateurs peuvent produire un S « haut » : (r, n − s) est la même signature.
    let sig = sig.normalize_s().unwrap_or(sig);
    let mut msg = authenticator_data.to_vec();
    msg.extend_from_slice(&Sha256::digest(client_data_json));
    key.verify(&msg, &sig).map_err(|_| "signature invalide")?;
    let count = counter(authenticator_data);
    if (count != 0 || stored_count != 0) && count <= stored_count {
        return Err("compteur de la clé en recul (clé clonée ?)");
    }
    Ok(count)
}

/// Défi aléatoire de 32 octets, en base64url.
pub fn new_challenge() -> String {
    use rand::RngCore;
    let mut b = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut b);
    b64u(&b)
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use p256::ecdsa::{signature::Signer, SigningKey};

    /// Authentificateur logiciel pour les tests.
    pub struct SoftKey {
        pub sk: SigningKey,
        pub id: Vec<u8>,
        pub count: u32,
    }

    pub fn rp_for_tests() -> (String, Vec<String>) {
        ("forgechat.example".into(), vec!["https://forgechat.example".into()])
    }

    pub fn client_data(kind: &str, challenge: &str, origin: &str) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({ "type": kind, "challenge": challenge, "origin": origin, "crossOrigin": false })).unwrap()
    }

    impl SoftKey {
        pub fn new() -> Self {
            SoftKey { sk: SigningKey::random(&mut rand::thread_rng()), id: (0..32u8).collect(), count: 0 }
        }

        fn auth_data(&self, rp_id: &str, flags: u8, attested: bool) -> Vec<u8> {
            let mut d = Sha256::digest(rp_id.as_bytes()).to_vec();
            d.push(flags);
            d.extend_from_slice(&self.count.to_be_bytes());
            if attested {
                d.extend_from_slice(&[0u8; 16]);
                d.extend_from_slice(&(self.id.len() as u16).to_be_bytes());
                d.extend_from_slice(&self.id);
                let p = self.sk.verifying_key().to_encoded_point(false);
                let cose = Value::Map(vec![
                    (int_key(1), int_key(2)),
                    (int_key(3), int_key(ALG_ES256)),
                    (int_key(-1), int_key(1)),
                    (int_key(-2), Value::Bytes(p.x().unwrap().to_vec())),
                    (int_key(-3), Value::Bytes(p.y().unwrap().to_vec())),
                ]);
                ciborium::ser::into_writer(&cose, &mut d).unwrap();
            }
            d
        }

        pub fn attestation(&self, rp_id: &str) -> Vec<u8> {
            let att = Value::Map(vec![
                (Value::Text("fmt".into()), Value::Text("none".into())),
                (Value::Text("attStmt".into()), Value::Map(vec![])),
                (Value::Text("authData".into()), Value::Bytes(self.auth_data(rp_id, FLAG_UP | FLAG_AT, true))),
            ]);
            let mut out = Vec::new();
            ciborium::ser::into_writer(&att, &mut out).unwrap();
            out
        }

        /// (authenticatorData, signature DER) pour ce clientDataJSON.
        pub fn assert(&mut self, rp_id: &str, client_data_json: &[u8]) -> (Vec<u8>, Vec<u8>) {
            self.count += 1;
            let ad = self.auth_data(rp_id, FLAG_UP, false);
            let mut msg = ad.clone();
            msg.extend_from_slice(&Sha256::digest(client_data_json));
            let sig: Signature = self.sk.sign(&msg);
            (ad, sig.to_der().as_bytes().to_vec())
        }
    }

    #[test]
    fn register_then_assert() {
        let (rp_id, origins) = rp_for_tests();
        let rp = RelyingParty { id: &rp_id, origins: &origins };
        let mut key = SoftKey::new();
        let ch = new_challenge();
        let cd = client_data("webauthn.create", &ch, &origins[0]);
        let cred = verify_registration(&cd, &key.attestation(&rp_id), &ch, &rp).expect("enregistrement");
        assert_eq!(cred.credential_id, key.id);
        assert_eq!(cred.public_key.len(), 65);

        let ch2 = new_challenge();
        let cd2 = client_data("webauthn.get", &ch2, &origins[0]);
        let (ad, sig) = key.assert(&rp_id, &cd2);
        assert_eq!(verify_assertion(&cd2, &ad, &sig, &ch2, &rp, &cred.public_key, 0), Ok(1));
        // Rejeu : même compteur refusé ; autre défi refusé.
        assert!(verify_assertion(&cd2, &ad, &sig, &ch2, &rp, &cred.public_key, 1).is_err());
        assert_eq!(verify_assertion(&cd2, &ad, &sig, &new_challenge(), &rp, &cred.public_key, 0), Err("défi inattendu"));
    }

    #[test]
    fn phishing_and_tampering_rejected() {
        let (rp_id, origins) = rp_for_tests();
        let rp = RelyingParty { id: &rp_id, origins: &origins };
        let mut key = SoftKey::new();
        let ch = new_challenge();
        // Fausse page : autre origine, ou authentificateur interrogé pour un autre domaine.
        let cd = client_data("webauthn.create", &ch, "https://forgechat-login.example");
        assert_eq!(verify_registration(&cd, &key.attestation(&rp_id), &ch, &rp), Err("origine refusée"));
        let cd = client_data("webauthn.create", &ch, &origins[0]);
        assert_eq!(verify_registration(&cd, &key.attestation("evil.example"), &ch, &rp), Err("domaine (rpId) inattendu"));
        let cd_get = client_data("webauthn.get", &ch, &origins[0]);
        assert_eq!(verify_registration(&cd_get, &key.attestation(&rp_id), &ch, &rp), Err("type de cérémonie inattendu"));

        let cred = verify_registration(&cd, &key.attestation(&rp_id), &ch, &rp).unwrap();
        let ch2 = new_challenge();
        let cd2 = client_data("webauthn.get", &ch2, &origins[0]);
        let (mut ad, sig) = key.assert(&rp_id, &cd2);
        ad[32] |= 0x04; // donnée signée modifiée
        assert_eq!(verify_assertion(&cd2, &ad, &sig, &ch2, &rp, &cred.public_key, 0), Err("signature invalide"));
        let other = SoftKey::new();
        let other_pk = other.sk.verifying_key().to_encoded_point(false).as_bytes().to_vec();
        let (ad, sig) = key.assert(&rp_id, &cd2);
        assert_eq!(verify_assertion(&cd2, &ad, &sig, &ch2, &rp, &other_pk, 0), Err("signature invalide"));
        // Sans présence de l'utilisateur (UP) : refus.
        let mut ad_no_up = ad.clone();
        ad_no_up[32] &= !FLAG_UP;
        assert!(verify_assertion(&cd2, &ad_no_up, &sig, &ch2, &rp, &cred.public_key, 0).is_err());
    }

    #[test]
    fn rejects_non_es256() {
        let (rp_id, origins) = rp_for_tests();
        let rp = RelyingParty { id: &rp_id, origins: &origins };
        let mut d = Sha256::digest(rp_id.as_bytes()).to_vec();
        d.push(FLAG_UP | FLAG_AT);
        d.extend_from_slice(&[0, 0, 0, 0]);
        d.extend_from_slice(&[0u8; 16]);
        d.extend_from_slice(&16u16.to_be_bytes());
        d.extend_from_slice(&[7u8; 16]);
        let cose = Value::Map(vec![(int_key(1), int_key(3)), (int_key(3), int_key(-257))]); // RS256
        ciborium::ser::into_writer(&cose, &mut d).unwrap();
        let att = Value::Map(vec![(Value::Text("authData".into()), Value::Bytes(d))]);
        let mut raw = Vec::new();
        ciborium::ser::into_writer(&att, &mut raw).unwrap();
        let ch = new_challenge();
        let cd = client_data("webauthn.create", &ch, &origins[0]);
        assert_eq!(verify_registration(&cd, &raw, &ch, &rp), Err("algorithme non pris en charge (ES256 / P-256 seulement)"));
    }
}
