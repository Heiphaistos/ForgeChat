fn main() {
    verifier_version_unique();
    tauri_build::build()
}

/// `tauri.conf.json` et `Cargo.toml` portent tous deux la version, et Tauri ne
/// les compare pas : si elles divergent, le build reussit en silence et
/// l'updater compare la mauvaise (`updater.rs` lit `CARGO_PKG_VERSION`, tandis
/// que `build.bat` / `build.sh` / `publier-manifeste.sh` lisent
/// `tauri.conf.json`). Un artefact serait alors publie sous un numero que
/// l'application ne reconnait pas -- mise a jour proposee en boucle, ou jamais.
///
/// On casse donc le build plutot que de laisser la derive s'installer.
fn verifier_version_unique() {
    println!("cargo:rerun-if-changed=tauri.conf.json");

    let conf = std::fs::read_to_string("tauri.conf.json")
        .expect("tauri.conf.json illisible depuis build.rs");
    let conf: serde_json::Value =
        serde_json::from_str(&conf).expect("tauri.conf.json mal forme");

    let Some(version_conf) = conf.get("version").and_then(|v| v.as_str()) else {
        // Champ absent : Tauri retombe sur Cargo.toml, il n'y a rien a comparer.
        return;
    };
    let version_cargo = env!("CARGO_PKG_VERSION");

    assert_eq!(
        version_conf, version_cargo,
        "\n\nVersions divergentes : tauri.conf.json annonce {version_conf}, \
         Cargo.toml annonce {version_cargo}.\nLes deux doivent etre identiques \
         (l'updater lit Cargo.toml, les scripts de build lisent tauri.conf.json).\n"
    );
}
