//! Effacement des fichiers de `/uploads` devenus inutiles (sorti de uploads.rs).
//!
//! Avant : `remove_upload_files` ignorait toute URL contenant un `/` après
//! `/uploads/`, donc les avatars, bannières et profils de serveur
//! (`/uploads/<dossier>/<nom>`) n'étaient jamais effacés (RGPD), et
//! `remove_unreferenced` ignorait `server_avatar` / `server_banner`.

use std::path::PathBuf;

use uuid::Uuid;

use crate::state::AppState;

/// Chemin relatif sûr d'une URL `/uploads/<nom>` ou `/uploads/<dossier>/<nom>` :
/// segments non vides en `[A-Za-z0-9._-]`, sans `.`/`..` ni point initial.
/// `None` pour tout le reste (traversée, séparateur Windows, URL externe).
pub fn upload_rel_path(url: &str) -> Option<PathBuf> {
    let rel = url.strip_prefix("/uploads/")?;
    let parts: Vec<&str> = rel.split('/').collect();
    if parts.len() > 2 {
        return None;
    }
    let ok = |p: &&str| {
        !p.is_empty()
            && !p.starts_with('.')
            && p.chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    };
    parts.iter().all(ok).then(|| parts.iter().collect())
}

/// Supprime du disque les fichiers `/uploads/...` (en tâche de fond, échec
/// journalisé : la base est la source de vérité). Une image animée `a_<id>.<ext>`
/// emporte sa version fixe `a_<id>_s.<ext>`.
pub fn remove_upload_files(state: &AppState, urls: Vec<String>) {
    if urls.is_empty() {
        return;
    }
    let upload_dir = PathBuf::from(&state.config.upload_dir);
    tokio::spawn(async move {
        for url in urls {
            let Some(rel) = upload_rel_path(&url) else {
                continue;
            };
            let mut paths = vec![upload_dir.join(&rel)];
            if let Some(name) = rel
                .file_name()
                .and_then(|n| n.to_str())
                .filter(|n| n.starts_with("a_"))
            {
                paths.push(
                    upload_dir.join(
                        rel.with_file_name(crate::handlers::profile_custom::still_name(name)),
                    ),
                );
            }
            for path in paths {
                if let Err(e) = tokio::fs::remove_file(&path).await {
                    if e.kind() != std::io::ErrorKind::NotFound {
                        tracing::warn!("Fichier {} non supprimé : {e}", path.display());
                    }
                }
            }
        }
    });
}

/// Fichiers d'un serveur (pièces jointes de ses salons, icône, bannière, émojis, autocollants,
/// sons, profils de membres), relevés AVANT sa suppression : la cascade efface les lignes, pas les fichiers.
pub async fn server_upload_candidates(db: &sqlx::PgPool, server_id: Uuid) -> Vec<String> {
    sqlx::query_scalar(
        "SELECT a.url FROM attachments a JOIN messages m ON m.id = a.message_id
           JOIN channels c ON c.id = m.channel_id WHERE c.server_id = $1
         UNION SELECT icon FROM servers WHERE id = $1 AND icon IS NOT NULL
         UNION SELECT banner FROM servers WHERE id = $1 AND banner IS NOT NULL
         UNION SELECT look->'sidebar_bg'->>'image' FROM servers WHERE id = $1 AND look->'sidebar_bg'->>'image' IS NOT NULL
         UNION SELECT look->'message_bg'->>'image' FROM servers WHERE id = $1 AND look->'message_bg'->>'image' IS NOT NULL
         UNION SELECT url FROM custom_emojis WHERE server_id = $1
         UNION SELECT url FROM server_stickers WHERE server_id = $1
         UNION SELECT file_url FROM soundboard WHERE server_id = $1
         UNION SELECT server_avatar FROM server_members WHERE server_id = $1 AND server_avatar IS NOT NULL
         UNION SELECT server_banner FROM server_members WHERE server_id = $1 AND server_banner IS NOT NULL",
    )
    .bind(server_id)
    .fetch_all(db)
    .await
    .unwrap_or_default()
}

/// Fichiers d'un compte (pièces jointes envoyées, avatar, bannière, profils de
/// serveur), relevés AVANT sa suppression.
pub async fn user_upload_candidates(db: &sqlx::PgPool, user_id: Uuid) -> Vec<String> {
    sqlx::query_scalar(
        "SELECT url FROM attachments WHERE uploader_id = $1
         UNION SELECT avatar FROM users WHERE id = $1 AND avatar IS NOT NULL
         UNION SELECT banner FROM users WHERE id = $1 AND banner IS NOT NULL
         UNION SELECT server_avatar FROM server_members WHERE user_id = $1 AND server_avatar IS NOT NULL
         UNION SELECT server_banner FROM server_members WHERE user_id = $1 AND server_banner IS NOT NULL",
    )
    .bind(user_id)
    .fetch_all(db)
    .await
    .unwrap_or_default()
}

/// Après une suppression ou un remplacement : efface du disque les fichiers candidats que plus
/// aucune ligne ne référence (un fichier encore utilisé ailleurs reste en place).
pub async fn remove_unreferenced(state: &AppState, candidates: Vec<String>) {
    if candidates.is_empty() {
        return;
    }
    let gone: Vec<String> = match sqlx::query_scalar(
        "SELECT u FROM unnest($1::text[]) AS u
         WHERE NOT EXISTS (SELECT 1 FROM attachments WHERE url = u)
           AND NOT EXISTS (SELECT 1 FROM users WHERE avatar = u OR banner = u)
           AND NOT EXISTS (SELECT 1 FROM server_members WHERE server_avatar = u OR server_banner = u)
           AND NOT EXISTS (SELECT 1 FROM servers WHERE icon = u OR banner = u
                           OR look->'sidebar_bg'->>'image' = u OR look->'message_bg'->>'image' = u)
           AND NOT EXISTS (SELECT 1 FROM custom_emojis WHERE url = u)
           AND NOT EXISTS (SELECT 1 FROM server_stickers WHERE url = u)
           AND NOT EXISTS (SELECT 1 FROM soundboard WHERE file_url = u)",
    )
    .bind(&candidates)
    .fetch_all(&state.db)
    .await
    {
        Ok(g) => g,
        Err(e) => {
            // Dans le doute on garde les fichiers (jamais d'effacement à l'aveugle).
            tracing::warn!("Nettoyage des fichiers ignoré : {e}");
            return;
        }
    };
    remove_upload_files(state, gone);
}

/// Image remplacée ou retirée (avatar, bannière, profil de serveur) : efface
/// l'ancienne si plus rien ne la référence.
pub async fn drop_replaced(state: &AppState, old: Option<String>) {
    if let Some(old) = old.filter(|o| !o.is_empty()) {
        remove_unreferenced(state, vec![old]).await;
    }
}

#[cfg(test)]
mod tests {
    use super::upload_rel_path;
    use std::path::PathBuf;

    #[test]
    fn chemins() {
        assert_eq!(
            upload_rel_path("/uploads/abc.png"),
            Some(PathBuf::from("abc.png"))
        );
        assert_eq!(
            upload_rel_path("/uploads/avatars/a_1.gif"),
            Some(PathBuf::from("avatars").join("a_1.gif"))
        );
        for bad in [
            "/uploads/../x",
            "/uploads/avatars/../../x",
            "/uploads/a/b/c.png",
            "/uploads/.env",
            "/uploads/a\\b",
            "/uploads/",
            "/uploads//x",
            "https://x/uploads/a.png",
            "/uploads/a b.png",
        ] {
            assert_eq!(upload_rel_path(bad), None, "{bad}");
        }
    }
}
