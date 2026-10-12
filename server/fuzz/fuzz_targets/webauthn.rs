#![no_main]
// Réponses d'authentificateur arbitraires : le serveur doit refuser proprement, jamais paniquer.
use libfuzzer_sys::fuzz_target;

#[allow(dead_code)]
#[path = "../../src/webauthn.rs"]
mod webauthn;

fuzz_target!(|data: &[u8]| {
    let origins = vec!["https://forgechat.example".to_string()];
    let rp = webauthn::RelyingParty { id: "forgechat.example", origins: &origins };
    let challenge = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    // Découpage de l'entrée en clientDataJSON, authData/attestation et signature.
    let a = data.first().copied().unwrap_or(0) as usize;
    let b = data.get(1).copied().unwrap_or(0) as usize;
    let rest = data.get(2..).unwrap_or(&[]);
    let (cd, rest) = rest.split_at(a.min(rest.len()));
    let (blob, sig) = rest.split_at((b * 4).min(rest.len()));
    let _ = webauthn::verify_registration(cd, blob, challenge, &rp);
    let pk = [4u8; 65];
    let _ = webauthn::verify_assertion(cd, blob, sig, challenge, &rp, &pk, 0);
});
