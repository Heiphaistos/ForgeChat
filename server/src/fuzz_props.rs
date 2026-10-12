//! Fuzzing par propriétés (audit 2026-10-12, amélioration n° 22), sur la chaîne stable : lancé par
//! `cargo test` en CI. Toutes les fonctions qui lisent des données venues de l'extérieur (corps
//! de requête, en-têtes, réponses de l'authentificateur, URL) reçoivent des entrées aléatoires et
//! ne doivent jamais paniquer ; certaines garanties de sortie sont vérifiées au passage.
//! Fuzzing guidé par la couverture (cargo-fuzz, nightly) : dossier `server/fuzz`.
use proptest::prelude::*;

fn config(cases: u32) -> ProptestConfig {
    ProptestConfig { cases, failure_persistence: None, ..ProptestConfig::default() }
}

proptest! {
    #![proptest_config(config(2000))]

    #[test]
    fn csp_reports_never_panic(raw in proptest::collection::vec(any::<u8>(), 0..2048)) {
        let v = crate::handlers::diagnostics::parse_csp_reports(&raw);
        prop_assert!(v.len() <= 10);
    }

    #[test]
    fn csp_reports_strip_queries(doc in "[a-z:/.?#=&]{0,80}", blocked in "[a-z:/.?#=&]{0,80}", sample in "\\PC{0,300}") {
        let body = serde_json::json!({ "csp-report": { "document-uri": doc, "blocked-uri": blocked, "effective-directive": "img-src", "script-sample": sample } });
        for c in crate::handlers::diagnostics::parse_csp_reports(body.to_string().as_bytes()) {
            prop_assert!(!c.document.contains(['?', '#']) && !c.blocked.contains(['?', '#']));
            prop_assert!(c.sample.chars().count() <= 220);
        }
    }

    #[test]
    fn scrub_secrets_never_panics(s in "\\PC{0,400}") {
        let out = crate::handlers::diagnostics::scrub_secrets(&s);
        // Un jeton porteur ne survit jamais au nettoyage.
        let with_token = format!("{s} Bearer abcdefghijklmnopqrstuvwxyz0123456789");
        prop_assert!(!crate::handlers::diagnostics::scrub_secrets(&with_token).contains("abcdefghijklmnopqrstuvwxyz0123456789"));
        let _ = out;
    }

    #[test]
    fn device_label_and_redaction_never_panic(s in "\\PC{0,300}") {
        let label = crate::privacy::device_label(&s, true);
        prop_assert!(label.len() <= 200);
        let red = crate::privacy::redact_emails(&format!("{s} alice.dupont@example.org"));
        prop_assert!(!red.contains("alice.dupont@example.org"));
    }

    #[test]
    fn url_guard_never_panics(s in "\\PC{0,200}") {
        let _ = crate::net_guard::url_str_target_ok(&s);
    }

    #[test]
    fn pwned_compact_only_valid_lines(body in "[0-9A-Fa-f:\\r\\nZ ]{0,600}") {
        for line in crate::handlers::pwned::compact(&body).lines() {
            let (suffix, n) = line.split_once(':').expect("forme SUFFIXE:n");
            prop_assert_eq!(suffix.len(), 35);
            prop_assert!(n.parse::<u64>().unwrap() > 0);
        }
    }

    #[test]
    fn cookie_parse_never_panics(s in "[ -~]{0,300}") {
        let mut h = axum::http::HeaderMap::new();
        if let Ok(v) = axum::http::HeaderValue::from_str(&s) {
            h.insert("cookie", v);
            let _ = crate::cookies::parse(&h);
            let _ = crate::cookies::access_token(&h, true);
            let _ = crate::cookies::refresh_token(&h, true, 0);
            let _ = crate::handlers::account_guard::presented_device(&h, true);
        }
    }

    #[test]
    fn public_key_parse_never_panics(s in "\\PC{0,200}") {
        let _ = crate::handlers::user_keys::public_fingerprint(&s);
    }
}

proptest! {
    #![proptest_config(config(1000))]

    /// Réponses d'authentificateur quelconques : refus propre, jamais de panique.
    #[test]
    fn webauthn_never_panics(
        client_data in proptest::collection::vec(any::<u8>(), 0..512),
        blob in proptest::collection::vec(any::<u8>(), 0..1024),
        sig in proptest::collection::vec(any::<u8>(), 0..128),
        count in any::<u32>(),
    ) {
        let origins = vec!["https://forgechat.example".to_string()];
        let rp = crate::webauthn::RelyingParty { id: "forgechat.example", origins: &origins };
        let ch = crate::webauthn::new_challenge();
        let _ = crate::webauthn::verify_registration(&client_data, &blob, &ch, &rp);
        let pk = [4u8; 65];
        let _ = crate::webauthn::verify_assertion(&client_data, &blob, &sig, &ch, &rp, &pk, count);
    }

    /// authData valide en tête mais tronqué ou gonflé n'importe où : jamais de panique.
    #[test]
    fn webauthn_truncated_auth_data(cut in 0usize..400, junk in proptest::collection::vec(any::<u8>(), 0..64)) {
        use crate::webauthn::tests::{client_data, SoftKey};
        let origins = vec!["https://forgechat.example".to_string()];
        let rp = crate::webauthn::RelyingParty { id: "forgechat.example", origins: &origins };
        let ch = crate::webauthn::new_challenge();
        let cd = client_data("webauthn.create", &ch, &origins[0]);
        let mut att = SoftKey::new().attestation("forgechat.example");
        att.truncate(cut.min(att.len()));
        att.extend_from_slice(&junk);
        let _ = crate::webauthn::verify_registration(&cd, &att, &ch, &rp);
    }
}
