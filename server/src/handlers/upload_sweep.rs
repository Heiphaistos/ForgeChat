//! Balayage ponctuel des fichiers orphelins de `UPLOAD_DIR` (RGPD, audit S6).
//!
//! Usage (même `.env` que le serveur, aucun démarrage HTTP, aucune migration) :
//!
//! ```text
//! forgechat sweep-orphan-uploads > orphelins.tsv
//! ```
//!
//! LECTURE SEULE : liste sur stdout `<octets>\t<chemin absolu>` des fichiers que plus aucune
//! ligne de la base ne référence, total sur stderr. Rien n'est effacé : relire la liste, puis
//! effacer à la main (`cut -f2 orphelins.tsv | xargs -d '\n' rm --`).
//!
//! Garde-fous : références relevées dans TOUTES les colonnes texte/JSON/tableaux du catalogue
//! (pas une liste figée qui oublierait une colonne) ; fichiers de moins de 24 h ignorés (envoi
//! en cours) ; liens symboliques jamais suivis ; profondeur max 2 (`<nom>` ou `<dossier>/<nom>`) ;
//! noms hors `upload_rel_path` (fichiers cachés, caractères exotiques) jamais proposés.
//!
//! ponytail: pas d'option `--delete` tant que la requête du catalogue n'a pas tourné sur une
//! vraie base ; l'ajouter après une première liste vérifiée en production.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use futures_util::TryStreamExt;

use super::upload_gc::upload_rel_path;

/// Un fichier plus jeune peut appartenir à un envoi pas encore rattaché à une ligne.
const MIN_AGE: Duration = Duration::from_secs(24 * 3600);
const MARKER: &str = "/uploads/";

/// Fichier candidat trouvé sur disque.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiskFile {
    /// Chemin relatif au format URL (`nom` ou `dossier/nom`).
    pub rel: String,
    pub size: u64,
    pub modified: SystemTime,
}

/// Chemins relatifs (`nom` ou `dossier/nom`) de toutes les URL `/uploads/...` d'un texte
/// (colonne simple, JSON, contenu de message, URL absolue). Signature `?…` et ponctuation
/// finale coupées : en cas de doute on garde plus de références, jamais moins.
pub fn extract_refs(text: &str, out: &mut HashSet<String>) {
    let mut rest = text;
    while let Some(i) = rest.find(MARKER) {
        let tail = &rest[i + MARKER.len()..];
        let end = tail
            .find(|c: char| !(c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/')))
            .unwrap_or(tail.len());
        let raw = &tail[..end];
        for cand in [raw, raw.trim_end_matches(['.', '/'])] {
            if upload_rel_path(&format!("{MARKER}{cand}")).is_some() {
                out.insert(cand.to_string());
                // Une image animée `a_<id>.<ext>` a sa version fixe `a_<id>_s.<ext>` sur disque.
                let (dir, name) = cand.rsplit_once('/').unwrap_or(("", cand));
                if name.starts_with("a_") {
                    let still = crate::handlers::profile_custom::still_name(name);
                    out.insert(if dir.is_empty() {
                        still
                    } else {
                        format!("{dir}/{still}")
                    });
                }
            }
        }
        rest = tail;
    }
}

/// Fichiers non référencés et assez vieux, triés par chemin.
pub fn orphans(
    files: Vec<DiskFile>,
    referenced: &HashSet<String>,
    now: SystemTime,
) -> Vec<DiskFile> {
    let mut out: Vec<DiskFile> = files
        .into_iter()
        .filter(|f| !referenced.contains(&f.rel))
        .filter(|f| {
            now.duration_since(f.modified)
                .map(|age| age >= MIN_AGE)
                .unwrap_or(false)
        })
        .collect();
    out.sort_by(|a, b| a.rel.cmp(&b.rel));
    out
}

/// Fichiers ordinaires de `root` et de ses sous-dossiers directs, sans suivre aucun lien
/// symbolique ; seuls les noms acceptés par `upload_rel_path` sont retenus.
pub fn walk(root: &Path) -> std::io::Result<Vec<DiskFile>> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(root)? {
        let entry = entry?;
        let meta = entry.path().symlink_metadata()?;
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if meta.is_file() {
            push_file(&mut out, name, &meta);
        } else if meta.is_dir() {
            for sub in std::fs::read_dir(entry.path())? {
                let sub = sub?;
                let sub_meta = sub.path().symlink_metadata()?;
                let Some(sub_name) = sub.file_name().to_str().map(str::to_owned) else {
                    continue;
                };
                if sub_meta.is_file() {
                    push_file(&mut out, format!("{name}/{sub_name}"), &sub_meta);
                }
            }
        }
    }
    Ok(out)
}

fn push_file(out: &mut Vec<DiskFile>, rel: String, meta: &std::fs::Metadata) {
    if upload_rel_path(&format!("{MARKER}{rel}")).is_some() {
        if let Ok(modified) = meta.modified() {
            out.push(DiskFile {
                rel,
                size: meta.len(),
                modified,
            });
        }
    }
}

/// `"x"` → `"\"x\""` (identifiant SQL, guillemets internes doublés).
fn quote_ident(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

/// Toutes les références `/uploads/...` de toutes les colonnes texte, JSON et tableaux de
/// texte des tables ordinaires (hors schémas système).
async fn referenced(db: &sqlx::PgPool) -> anyhow::Result<HashSet<String>> {
    let cols: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT c.table_schema::text, c.table_name::text, c.column_name::text
           FROM information_schema.columns c
           JOIN information_schema.tables t
             ON t.table_schema = c.table_schema AND t.table_name = c.table_name
          WHERE t.table_type = 'BASE TABLE'
            AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
            AND (c.data_type IN ('text', 'character varying', 'character', 'json', 'jsonb')
                 OR c.udt_name IN ('_text', '_varchar', '_bpchar', '_json', '_jsonb'))",
    )
    .fetch_all(db)
    .await?;
    anyhow::ensure!(
        !cols.is_empty(),
        "aucune colonne texte trouvée dans le catalogue"
    );
    let mut refs = HashSet::new();
    for (schema, table, col) in &cols {
        let sql = format!(
            "SELECT {c}::text FROM {s}.{t} WHERE {c}::text LIKE '%/uploads/%'",
            c = quote_ident(col),
            s = quote_ident(schema),
            t = quote_ident(table),
        );
        let mut rows = sqlx::query_scalar::<_, String>(&sql).fetch(db);
        while let Some(text) = rows.try_next().await? {
            extract_refs(&text, &mut refs);
        }
    }
    eprintln!(
        "{} colonne(s) lue(s), {} référence(s) distincte(s)",
        cols.len(),
        refs.len()
    );
    Ok(refs)
}

/// Point d'entrée de `forgechat sweep-orphan-uploads` (lecture seule, voir l'en-tête).
pub async fn run_cli() -> anyhow::Result<()> {
    let config = crate::config::Config::from_env()?;
    let root: PathBuf = Path::new(&config.upload_dir).canonicalize()?;
    let db = sqlx::postgres::PgPoolOptions::new()
        .max_connections(2)
        .connect(&config.database_url)
        .await?;
    let refs = referenced(&db).await?;
    let found = orphans(walk(&root)?, &refs, SystemTime::now());
    let mut total = 0u64;
    for f in &found {
        let path = root.join(Path::new(&f.rel));
        // Ceinture et bretelles : rien hors du dossier (aucun lien n'a été suivi de toute façon).
        if path
            .canonicalize()
            .map(|p| p.starts_with(&root))
            .unwrap_or(false)
        {
            total += f.size;
            println!("{}\t{}", f.size, path.display());
        }
    }
    eprintln!(
        "{} fichier(s) orphelin(s), {} octet(s) — lecture seule, rien n'a été effacé",
        found.len(),
        total
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn refs(texts: &[&str]) -> HashSet<String> {
        let mut out = HashSet::new();
        for t in texts {
            extract_refs(t, &mut out);
        }
        out
    }

    #[test]
    fn references_extraites() {
        let r = refs(&[
            "/uploads/abc.png",
            r#"{"sidebar_bg":{"image":"/uploads/server-banners/a_1.gif"}}"#,
            "vu ici https://chat.example/uploads/x.enc?sig=abc&exp=1. et /uploads/y.mp4.",
            "/uploads/../secret /uploads/a/b/c.png /uploads/.env",
        ]);
        for want in [
            "abc.png",
            "server-banners/a_1.gif",
            "server-banners/a_1_s.gif",
            "x.enc",
            "y.mp4",
        ] {
            assert!(r.contains(want), "{want} manquant dans {r:?}");
        }
        assert!(
            !r.iter()
                .any(|x| x.contains("..") || x.starts_with('.') || x.matches('/').count() > 1),
            "{r:?}"
        );
    }

    #[test]
    fn orphelins_vieux_seulement() {
        let now = SystemTime::now();
        let old = now - Duration::from_secs(48 * 3600);
        let young = now - Duration::from_secs(3600);
        let f = |rel: &str, modified| DiskFile {
            rel: rel.into(),
            size: 1,
            modified,
        };
        let files = vec![
            f("avatars/a_1.gif", old),
            f("avatars/a_1_s.gif", old),
            f("gone.png", old),
            f("emojis/gone.gif", old),
            f("fresh.png", young),
        ];
        let got: Vec<String> = orphans(files, &refs(&["/uploads/avatars/a_1.gif"]), now)
            .into_iter()
            .map(|f| f.rel)
            .collect();
        assert_eq!(got, vec!["emojis/gone.gif", "gone.png"]);
    }

    #[test]
    fn parcours_du_disque() {
        let root = std::env::temp_dir().join(format!("fc-sweep-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("avatars").join("deep")).unwrap();
        std::fs::write(root.join("a.png"), b"x").unwrap();
        std::fs::write(root.join(".env"), b"x").unwrap();
        std::fs::write(root.join("avatars").join("b.png"), b"xy").unwrap();
        std::fs::write(root.join("avatars").join("deep").join("c.png"), b"x").unwrap();
        let mut got: Vec<(String, u64)> = walk(&root)
            .unwrap()
            .into_iter()
            .map(|f| (f.rel, f.size))
            .collect();
        got.sort();
        std::fs::remove_dir_all(&root).unwrap();
        assert_eq!(got, vec![("a.png".into(), 1), ("avatars/b.png".into(), 2)]);
    }

    #[test]
    fn identifiant_sql() {
        assert_eq!(quote_ident(r#"a"b"#), r#""a""b""#);
    }
}
