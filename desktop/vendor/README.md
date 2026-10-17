# Dépendances corrigées localement

- `webrtc-sys-build` 0.3.19 : copie du crate publié, une seule modification : `zip` 0.6 → 9
  (RUSTSEC-2026-0367/0368/0369, extraction de l'archive WebRTC à la compilation). À retirer dès
  qu'une version amont utilise `zip` ≥ 9 : supprimer ce dossier et la section `[patch.crates-io]`
  de `src-tauri/Cargo.toml`, puis `cargo update -p webrtc-sys-build`.
