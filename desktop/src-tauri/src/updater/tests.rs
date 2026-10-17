use super::*;

/// Vecteur de test FIPS 180-4 : SHA-256("abc").
const ABC: &[u8] = b"abc";
const SHA_ABC: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

#[test]
fn compare_les_versions() {
    assert!(plus_recente("3.24.0", "3.23.0"));
    assert!(plus_recente("3.23.1", "3.23.0"));
    assert!(plus_recente("4.0.0", "3.99.99"));
    assert!(!plus_recente("3.23.0", "3.23.0"));
    assert!(!plus_recente("3.22.0", "3.23.0"));
    // Comparaison numérique, pas lexicographique : 3.9.0 < 3.23.0.
    assert!(!plus_recente("3.9.0", "3.23.0"));
}

/// Les cas qui piègent un comparateur écrit à la va-vite.
#[test]
fn compare_les_versions_cas_pieges() {
    // Lexicographiquement "3.9.0" > "3.24.0" ; numériquement non.
    assert!(!plus_recente("3.9.0", "3.24.0"));
    assert!(plus_recente("3.24.0", "3.9.0"));
    // Égalité stricte : aucune mise à jour proposée.
    assert!(!plus_recente("3.24.0", "3.24.0"));
    // Patch suivant.
    assert!(plus_recente("3.25.0", "3.24.0"));
    // Malformé des deux côtés : refus, et surtout aucune panique.
    for v in [
        "",
        "   ",
        "3",
        "3.24",
        "3.24.0.1",
        "v3.24.0",
        "3.24.x",
        "-1.0.0",
        "99999999999999999999.0.0",
        "3.24.0-rc1",
    ] {
        assert!(!plus_recente(v, "3.24.0"), "{v} ne doit pas déclencher");
        assert!(!plus_recente("3.24.0", v), "{v} ne doit pas servir de base");
    }
}

// ── La garde SHA-256 ────────────────────────────────────────────

#[test]
fn empreinte_correcte_acceptee() {
    assert_eq!(verifier_empreinte(ABC, SHA_ABC), Ok(()));
}

#[test]
fn un_seul_octet_modifie_fait_echouer_la_verification() {
    // « abc » → « abd » : un bit de différence suffit.
    let altere = b"abd";
    let obtenu = hex(&Sha256::digest(altere));
    let e = verifier_empreinte(altere, SHA_ABC).expect_err("un octet changé doit être refusé");
    assert!(
        e.contains(SHA_ABC),
        "le message doit nommer l'attendu : {e}"
    );
    assert!(e.contains(&obtenu), "le message doit nommer l'obtenu : {e}");
    assert!(e.contains("Mise à jour annulée"));

    // Même artefact, même taille, un seul octet retourné au milieu.
    let mut gros = vec![0u8; 4096];
    let bon = hex(&Sha256::digest(&gros));
    gros[2048] ^= 0x01;
    assert!(verifier_empreinte(&gros, &bon).is_err());
}

#[test]
fn la_casse_et_les_espaces_de_l_empreinte_attendue_sont_tolerees() {
    // Comportement réel : `eq_ignore_ascii_case` sur l'attendu `trim()`.
    assert!(verifier_empreinte(ABC, &SHA_ABC.to_uppercase()).is_ok());
    assert!(verifier_empreinte(ABC, &format!("  {SHA_ABC}  ")).is_ok());
    assert!(verifier_empreinte(ABC, &format!("\n\t{}\r\n", SHA_ABC.to_uppercase())).is_ok());
    // En revanche rien d'autre n'est toléré : ni troncature, ni préfixe.
    assert!(verifier_empreinte(ABC, &SHA_ABC[..63]).is_err());
    assert!(verifier_empreinte(ABC, &format!("sha256:{SHA_ABC}")).is_err());
    assert!(verifier_empreinte(ABC, "").is_err());
}

// ── Le manifeste ────────────────────────────────────────────────

fn manifeste(sha: &str) -> Manifeste {
    serde_json::from_str(&format!(
        r#"{{"version":"3.25.0","notes":"n","pub_date":"d","platforms":{{
             "windows-portable":{{"url":"https://forgechat.heiphaistos.org/desktop/ForgeChat-Portable-v3.25.0.exe","sha256":"{sha}","size":1}}}}}}"#
    ))
    .expect("manifeste de test illisible")
}

#[test]
fn un_artefact_sans_empreinte_est_refuse() {
    for sha in ["", "   ", "\\t"] {
        let r = choisir_artefact(&manifeste(sha), "windows-portable", "3.24.0");
        let e = r.expect_err("un artefact sans SHA-256 doit être refusé");
        assert!(e.contains("sans empreinte SHA-256"), "{e}");
    }
    // Avec empreinte, la même cible passe : le refus vient bien du champ vide.
    let ok = choisir_artefact(&manifeste(SHA_ABC), "windows-portable", "3.24.0")
        .expect("artefact valide refusé");
    let info = ok.expect("mise à jour attendue");
    assert_eq!(info.sha256, SHA_ABC);
    assert!(info.portable);
}

#[test]
fn meme_version_ne_propose_rien_et_cible_absente_echoue() {
    assert!(
        choisir_artefact(&manifeste(SHA_ABC), "windows-portable", "3.25.0")
            .expect("même version : pas une erreur")
            .is_none()
    );
    let e = choisir_artefact(&manifeste(SHA_ABC), "linux-portable", "3.24.0")
        .expect_err("cible absente du manifeste");
    assert!(e.contains("aucun artefact publié"), "{e}");
}

// ── Intégration réseau ──────────────────────────────────────────
//
// Touche le vrai endpoint et télécharge le vrai artefact.
// Lancer avec :
//     cargo test --lib -- --ignored --nocapture
#[test]
#[ignore = "réseau : interroge forgechat.heiphaistos.org et télécharge l'artefact"]
fn l_artefact_publie_correspond_a_son_empreinte() {
    tauri::async_runtime::block_on(async {
        let texte = client()
            .expect("client")
            .get(endpoint())
            .send()
            .await
            .expect("endpoint injoignable")
            .error_for_status()
            .expect("endpoint en erreur")
            .text()
            .await
            .expect("corps illisible");

        let m: Manifeste = serde_json::from_str(&texte).expect("manifeste illisible");
        let a = m
            .platforms
            .get("windows-portable")
            .expect("windows-portable absent du manifeste");
        println!("manifeste {} → {} ({})", m.version, a.url, a.sha256);

        let mut octets = telecharger(&a.url, TAILLE_MAX, |_, _| {})
            .await
            .expect("téléchargement");
        println!("{} octets téléchargés", octets.len());

        verifier_empreinte(&octets, &a.sha256)
            .expect("l'artefact publié ne correspond pas à son empreinte");
        println!("empreinte conforme");

        // Un seul octet modifié doit suffire à faire refuser l'artefact.
        let milieu = octets.len() / 2;
        octets[milieu] ^= 0x01;
        let e =
            verifier_empreinte(&octets, &a.sha256).expect_err("un octet modifié doit être refusé");
        println!("refus attendu : {e}");
        assert!(e.contains(a.sha256.trim()));
    });
}

// ── La signature ────────────────────────────────────────────────

/// Clé de TEST (graine fixe), jamais la clé de production.
fn cle_de_test() -> ed25519_dalek::SigningKey {
    ed25519_dalek::SigningKey::from_bytes(&[7u8; 32])
}

const SOMMES: &str = concat!(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  ForgeChat-Portable-v3.25.0.exe\n",
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 *ForgeChat-Setup-v3.25.0.exe\n",
);

fn signer(octets: &[u8]) -> String {
    use base64::Engine as _;
    use ed25519_dalek::Signer as _;
    base64::engine::general_purpose::STANDARD.encode(cle_de_test().sign(octets).to_bytes())
}

#[test]
fn signature_valide_rend_l_empreinte_de_la_ligne_signee() {
    let cle = cle_de_test().verifying_key().to_bytes();
    let sig = signer(SOMMES.as_bytes());
    assert_eq!(
        empreinte_signee(
            SOMMES.as_bytes(),
            &sig,
            "ForgeChat-Portable-v3.25.0.exe",
            &cle
        ),
        Ok(SHA_ABC.to_string())
    );
    // Format binaire de sha256sum (`*nom`) reconnu aussi.
    assert_eq!(
        empreinte_signee(SOMMES.as_bytes(), &sig, "ForgeChat-Setup-v3.25.0.exe", &cle),
        Ok("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".to_string())
    );
    // Le binaire « abc » passe la garde avec l'empreinte signée.
    assert!(verifier_empreinte(ABC, SHA_ABC).is_ok());
}

#[test]
fn liste_falsifiee_ou_mauvaise_cle_refusee() {
    let cle = cle_de_test().verifying_key().to_bytes();
    let sig = signer(SOMMES.as_bytes());
    // Un seul caractère de l'empreinte changé après signature.
    let falsifie = SOMMES.replacen("ba78", "ba79", 1);
    let e = empreinte_signee(
        falsifie.as_bytes(),
        &sig,
        "ForgeChat-Portable-v3.25.0.exe",
        &cle,
    )
    .expect_err("liste modifiée acceptée");
    assert!(e.contains("signature de la mise à jour invalide"), "{e}");
    // Bonne liste, mais signée par une autre clé que celle embarquée.
    assert!(empreinte_signee(
        SOMMES.as_bytes(),
        &sig,
        "ForgeChat-Portable-v3.25.0.exe",
        &CLE_PUBLIQUE
    )
    .is_err());
    // Signature tronquée ou illisible.
    for s in ["", "AAAA", "pas du base64 !", &sig[..40]] {
        assert!(
            empreinte_signee(SOMMES.as_bytes(), s, "ForgeChat-Portable-v3.25.0.exe", &cle).is_err()
        );
    }
}

#[test]
fn artefact_absent_de_la_liste_signee_refuse() {
    let cle = cle_de_test().verifying_key().to_bytes();
    let sig = signer(SOMMES.as_bytes());
    let e = empreinte_signee(
        SOMMES.as_bytes(),
        &sig,
        "ForgeChat-v3.25.0-amd64.AppImage",
        &cle,
    )
    .expect_err("ligne absente acceptée");
    assert!(e.contains("absent de la liste signée"), "{e}");
    // Un nom qui n'est qu'un suffixe d'une ligne ne compte pas.
    assert!(empreinte_signee(SOMMES.as_bytes(), &sig, "v3.25.0.exe", &cle).is_err());
}

#[test]
fn l_url_doit_venir_du_dossier_officiel_et_porter_la_version() {
    let b = BASE_TELECHARGEMENT;
    assert_eq!(
        nom_artefact(&format!("{b}ForgeChat-Setup-v3.25.0.exe"), "3.25.0"),
        Ok("ForgeChat-Setup-v3.25.0.exe")
    );
    assert!(nom_artefact(&format!("{b}ForgeChat-v3.25.0-amd64.deb"), "3.25.0").is_ok());
    assert!(nom_artefact(
        &format!("{b}ForgeChat-v3.25.0-x86_64.pkg.tar.zst"),
        "3.25.0"
    )
    .is_ok());
    for url in [
        "https://evil.example/desktop/ForgeChat-Setup-v3.25.0.exe".to_string(),
        "http://forgechat.heiphaistos.org/desktop/ForgeChat-Setup-v3.25.0.exe".to_string(),
        "https://forgechat.heiphaistos.org.evil.example/desktop/ForgeChat-Setup-v3.25.0.exe"
            .to_string(),
        format!("{b}../ForgeChat-Setup-v3.25.0.exe"),
        format!("{b}sous/ForgeChat-Setup-v3.25.0.exe"),
        format!("{b}ForgeChat-Setup-v3.24.0.exe"), // ancienne release signée resservie
        b.to_string(),
    ] {
        assert!(nom_artefact(&url, "3.25.0").is_err(), "{url} accepté");
    }
}

#[test]
fn un_manifeste_illisible_ne_met_rien_a_jour() {
    assert!(!plus_recente("pas-une-version", "3.23.0"));
    assert!(!plus_recente("", "3.23.0"));
    assert!(!plus_recente("3.24", "3.23.0"));
    assert!(!plus_recente("3.24.0.1", "3.23.0"));
}

#[test]
fn hex_rend_bien_le_sha256_connu() {
    // SHA-256 de la chaîne vide — valeur de référence publique.
    assert_eq!(
        hex(&Sha256::digest(b"")),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
}

#[test]
fn la_cible_est_une_des_quatre_publiees() {
    assert!(matches!(
        cible(),
        "windows-x86_64"
            | "windows-portable"
            | "linux-x86_64"
            | "linux-rpm"
            | "linux-arch"
            | "linux-portable"
            | "macos"
    ));
}

#[test]
fn un_dossier_inexistant_donne_un_message_clair_pas_un_succes() {
    let inexistant = Path::new("/dossier/qui/nexiste/pas/forgechat.exe");
    let r = verifier_dossier_inscriptible(inexistant);
    assert!(r.is_err());
    assert!(r.unwrap_err().contains("n'accepte pas l'écriture"));
}

#[test]
fn ecrire_neuf_refuse_un_fichier_existant() {
    let d = dossier_prive().unwrap();
    let f = d.join("x.nouveau-1");
    ecrire_neuf(&f, b"a").unwrap();
    assert!(ecrire_neuf(&f, b"b").is_err());
    assert_eq!(std::fs::read(&f).unwrap(), b"a");
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn suffixes_aleatoires_distincts() {
    assert_ne!(suffixe_aleatoire().unwrap(), suffixe_aleatoire().unwrap());
}

#[cfg(windows)]
#[test]
fn verrou_installeur_detecte_une_difference_et_bloque_l_ecriture() {
    let d = dossier_prive().unwrap();
    let f = d.join("setup.exe");
    ecrire_neuf(&f, b"abc").unwrap();
    assert!(verrouiller_et_verifier(&f, b"abd").is_err());
    let verrou = verrouiller_et_verifier(&f, b"abc").unwrap();
    assert!(std::fs::OpenOptions::new().write(true).open(&f).is_err());
    drop(verrou);
    let _ = std::fs::remove_dir_all(&d);
}
