//! Repli Linux du trousseau (session.rs) : sans Secret Service (pas de gnome-keyring ni de
//! KWallet joignable), les jetons de rafraîchissement vont dans `session.bin`, à côté des données
//! de l'appli, au lieu de n'exister qu'en mémoire (reconnexion à chaque lancement).
//!
//! Protection MOINDRE que le trousseau, et dite telle quelle : fichier 0600 chiffré
//! (ChaCha20-Poly1305) avec une clé dérivée de `/etc/machine-id` et de l'uid. Illisible copié sur
//! une autre machine (sauvegarde, synchro de dossier) et à l'œil nu ; mais tout programme qui
//! tourne sous ce compte, ou root, peut refaire la clé : ce n'est pas un coffre.
#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;

use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, CHACHA20_POLY1305, NONCE_LEN};
use ring::rand::{SecureRandom, SystemRandom};

/// Lectures-écritures du fichier une à la fois (lire, modifier, réécrire).
static LOCK: Mutex<()> = Mutex::new(());

pub struct FileStore {
    path: PathBuf,
    key: [u8; 32],
}

impl FileStore {
    pub fn new(path: PathBuf, key: [u8; 32]) -> Self {
        Self { path, key }
    }

    fn cipher(&self) -> LessSafeKey {
        LessSafeKey::new(UnboundKey::new(&CHACHA20_POLY1305, &self.key).expect("clé de 32 octets"))
    }

    /// Fichier absent, illisible ou d'une autre machine : vide.
    fn load(&self) -> BTreeMap<String, String> {
        let Ok(mut buf) = std::fs::read(&self.path) else {
            return BTreeMap::new();
        };
        if buf.len() < NONCE_LEN {
            return BTreeMap::new();
        }
        let mut body = buf.split_off(NONCE_LEN);
        let Ok(nonce) = Nonce::try_assume_unique_for_key(&buf) else {
            return BTreeMap::new();
        };
        self.cipher()
            .open_in_place(nonce, Aad::from(b"forgechat-session-v1"), &mut body)
            .ok()
            .and_then(|plain| serde_json::from_slice(plain).ok())
            .unwrap_or_default()
    }

    fn save(&self, map: &BTreeMap<String, String>) -> Result<(), String> {
        if map.is_empty() {
            return match std::fs::remove_file(&self.path) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
                _ => Ok(()),
            };
        }
        let mut nonce = [0u8; NONCE_LEN];
        SystemRandom::new()
            .fill(&mut nonce)
            .map_err(|_| "aléa indisponible")?;
        let mut body = serde_json::to_vec(map).map_err(|e| e.to_string())?;
        self.cipher()
            .seal_in_place_append_tag(
                Nonce::assume_unique_for_key(nonce),
                Aad::from(b"forgechat-session-v1"),
                &mut body,
            )
            .map_err(|_| "chiffrement impossible")?;
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        // Écrit à côté puis renommé : jamais de fichier à moitié écrit, jamais lisible par d'autres.
        let tmp = self.path.with_extension("tmp");
        let _ = std::fs::remove_file(&tmp);
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut opts, 0o600);
        let mut f = opts.open(&tmp).map_err(|e| e.to_string())?;
        std::io::Write::write_all(&mut f, &[&nonce[..], &body].concat())
            .map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &self.path).map_err(|e| e.to_string())
    }

    pub fn get(&self, user: &str) -> Option<String> {
        let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        self.load().remove(user)
    }

    pub fn set(&self, user: &str, secret: &str) -> Result<(), String> {
        let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut map = self.load();
        map.insert(user.to_string(), secret.to_string());
        self.save(&map)
    }

    pub fn del(&self, user: &str) -> Result<(), String> {
        let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut map = self.load();
        if map.remove(user).is_none() {
            return Ok(());
        }
        self.save(&map)
    }
}

/// Le fichier de cette machine et de ce compte ; `None` hors Linux (le trousseau y suffit).
pub fn machine() -> Option<FileStore> {
    #[cfg(target_os = "linux")]
    {
        use sha2::{Digest, Sha256};
        use std::os::unix::fs::MetadataExt;
        let id = std::fs::read_to_string("/etc/machine-id")
            .or_else(|_| std::fs::read_to_string("/var/lib/dbus/machine-id"))
            .ok()?;
        let home = std::env::var_os("HOME")?;
        let uid = std::fs::metadata(home).ok()?.uid();
        let key: [u8; 32] =
            Sha256::digest(format!("forgechat-session-v1\0{}\0{uid}", id.trim())).into();
        Some(FileStore::new(
            crate::compat::dossier_donnees()?.join("session.bin"),
            key,
        ))
    }
    #[cfg(not(target_os = "linux"))]
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(dir: &std::path::Path, key: u8) -> FileStore {
        FileStore::new(dir.join("session.bin"), [key; 32])
    }

    fn tmp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("fc-session-file-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn roundtrip_chiffre_et_efface() {
        let d = tmp_dir("rt");
        let s = store(&d, 7);
        s.set("refresh:active", "jeton-secret-123").unwrap();
        s.set("refresh:abc", "autre").unwrap();
        assert_eq!(s.get("refresh:active").as_deref(), Some("jeton-secret-123"));
        let raw = std::fs::read(d.join("session.bin")).unwrap();
        assert!(
            !raw.windows(5).any(|w| w == b"jeton"),
            "jeton en clair dans le fichier"
        );
        s.del("refresh:active").unwrap();
        assert_eq!(s.get("refresh:active"), None);
        assert_eq!(s.get("refresh:abc").as_deref(), Some("autre"));
        s.del("refresh:abc").unwrap();
        assert!(!d.join("session.bin").exists(), "fichier vide retiré");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn illisible_avec_une_autre_cle() {
        let d = tmp_dir("key");
        store(&d, 1).set("refresh:active", "t").unwrap();
        assert_eq!(store(&d, 2).get("refresh:active"), None);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[cfg(unix)]
    #[test]
    fn fichier_reserve_au_compte() {
        use std::os::unix::fs::PermissionsExt;
        let d = tmp_dir("perm");
        store(&d, 3).set("refresh:active", "t").unwrap();
        let mode = std::fs::metadata(d.join("session.bin"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
        let _ = std::fs::remove_dir_all(&d);
    }
}
