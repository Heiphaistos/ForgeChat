//! Règles pures de la synchronisation Discord (sans base, ni réseau) : validation de
//! la configuration, catégories exclues, curseurs incrémentaux.

use chrono::{DateTime, Utc};

/// Nombre de messages par page de l'API Discord (maximum autorisé).
pub const PAGE: usize = 100;
/// Exclusion par défaut : la catégorie d'actualités, supprimée côté ForgeChat.
pub const DEFAULT_EXCLUDED: &[&str] = &["actualité"];
pub const MAX_EXCLUDED: usize = 50;

const DISCORD_EPOCH_MS: i64 = 1_420_070_400_000;

// ─── Catégories exclues ─────────────────────────────────────────────────────

fn fold_char(c: char, out: &mut String) {
    let s = match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' => "a",
        'ç' => "c",
        'è' | 'é' | 'ê' | 'ë' => "e",
        'ì' | 'í' | 'î' | 'ï' => "i",
        'ñ' => "n",
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' => "o",
        'ù' | 'ú' | 'û' | 'ü' => "u",
        'ý' | 'ÿ' => "y",
        'œ' => "oe",
        'æ' => "ae",
        c if c.is_alphanumeric() => {
            out.push(c);
            return;
        }
        // Émojis, ponctuation, espaces, décorations (« ━━ ACTUALITÉS ━━ ») : ignorés
        _ => "",
    };
    out.push_str(s);
}

/// Forme de comparaison d'un nom de catégorie : minuscules, sans accents, lettres et
/// chiffres seulement, sans « s » final (« 📰 Actualités » == « actualite »).
pub fn fold_name(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for c in name.chars().flat_map(char::to_lowercase) {
        fold_char(c, &mut out);
    }
    if out.len() > 1 && out.ends_with('s') {
        out.pop();
    }
    out
}

/// Une règle désigne une catégorie par son identifiant Discord exact, ou par son nom
/// (comparé avec `fold_name`).
pub fn rule_matches(rule: &str, cat_id: &str, cat_name: &str) -> bool {
    let rule = rule.trim();
    if rule.is_empty() {
        return false;
    }
    if rule == cat_id {
        return true;
    }
    let r = fold_name(rule);
    !r.is_empty() && r == fold_name(cat_name)
}

pub fn is_excluded(rules: &[String], cat_id: &str, cat_name: &str) -> bool {
    rules.iter().any(|r| rule_matches(r, cat_id, cat_name))
}

/// Catégorie exclue par défaut (proposée cochée dans l'interface).
pub fn default_excluded(cat_name: &str) -> bool {
    DEFAULT_EXCLUDED.iter().any(|r| rule_matches(r, "", cat_name))
}

// ─── Validation de la configuration ─────────────────────────────────────────

/// Identifiant de serveur Discord (snowflake, 15 à 21 chiffres).
pub fn validate_guild_id(raw: &str) -> Result<String, &'static str> {
    let g = raw.trim();
    if (15..=21).contains(&g.len()) && g.bytes().all(|b| b.is_ascii_digit()) && g.parse::<u64>().is_ok() {
        Ok(g.to_string())
    } else {
        Err("Identifiant de serveur Discord invalide (nombre de 15 à 21 chiffres : clic droit sur le serveur > Copier l'identifiant).")
    }
}

/// Jeton de bot : préfixe « Bot » toléré, caractères base64url et points seulement.
pub fn normalize_token(raw: &str) -> Result<String, &'static str> {
    let t = raw.trim();
    let t = t.strip_prefix("Bot ").or_else(|| t.strip_prefix("bot ")).unwrap_or(t).trim();
    let ok = (50..=200).contains(&t.len())
        && t.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
        && t.matches('.').count() == 2;
    if ok { Ok(t.to_string()) } else { Err("Jeton de bot Discord invalide : copiez-le depuis le portail développeur (Bot > Reset Token).") }
}

pub fn validate_interval(hours: i64) -> Result<i16, &'static str> {
    match hours {
        24 => Ok(24),
        48 => Ok(48),
        _ => Err("Intervalle invalide : 24 ou 48 heures."),
    }
}

/// Règles d'exclusion nettoyées : sans vides ni doublons, 100 caractères au plus chacune.
pub fn validate_excluded(rules: &[String]) -> Result<Vec<String>, &'static str> {
    let mut out: Vec<String> = Vec::new();
    for r in rules {
        let r = r.trim();
        if r.is_empty() {
            continue;
        }
        if r.chars().count() > 100 || r.chars().any(char::is_control) {
            return Err("Catégorie exclue invalide (100 caractères au plus).");
        }
        if !out.iter().any(|o| o == r) {
            out.push(r.to_string());
        }
    }
    if out.len() > MAX_EXCLUDED {
        return Err("Trop de catégories exclues (50 au plus).");
    }
    Ok(out)
}

// ─── Curseurs ───────────────────────────────────────────────────────────────

pub fn snowflake(id: &str) -> u64 {
    id.parse().unwrap_or(0)
}

/// Plus grand identifiant Discord possible pour un instant donné : `after` = ce curseur
/// ne renvoie que les messages postés strictement après cette milliseconde.
pub fn snowflake_at(t: DateTime<Utc>) -> u64 {
    let ms = (t.timestamp_millis() - DISCORD_EPOCH_MS).max(0) as u64;
    (ms << 22) | ((1 << 22) - 1)
}

/// Curseur de départ d'un salon : le curseur enregistré, sinon (salon déjà présent,
/// importé depuis une archive) la date du dernier message importé, sinon le début (0).
pub fn initial_cursor(stored: Option<&str>, last_imported_at: Option<DateTime<Utc>>) -> u64 {
    match stored.map(snowflake).filter(|c| *c > 0) {
        Some(c) => c,
        None => last_imported_at.map(snowflake_at).unwrap_or(0),
    }
}

/// Une page reçue de `GET /channels/:id/messages?after=<cursor>&limit=100`.
#[derive(Debug, PartialEq)]
pub struct PageStep<T> {
    /// Messages strictement après le curseur, du plus ancien au plus récent, sans doublon.
    pub fresh: Vec<T>,
    /// Nouveau curseur (jamais en arrière).
    pub cursor: u64,
    /// Une page suivante peut exister.
    pub more: bool,
}

pub fn page_step<T>(cursor: u64, page: Vec<T>, id: impl Fn(&T) -> u64) -> PageStep<T> {
    let full = page.len() >= PAGE;
    let mut fresh: Vec<T> = page.into_iter().filter(|m| id(m) > cursor).collect();
    fresh.sort_by_key(|m| id(m));
    fresh.dedup_by_key(|m| id(m));
    let next = fresh.last().map(|m| id(m)).unwrap_or(cursor).max(cursor);
    // Page pleine mais sans progrès : on s'arrête (pas de boucle infinie).
    PageStep { more: full && next > cursor, cursor: next, fresh }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn rules(r: &[&str]) -> Vec<String> {
        r.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn actualite_matches_without_case_or_accents() {
        let d = rules(DEFAULT_EXCLUDED);
        for name in ["actualité", "Actualités", "ACTUALITE", "actualites", "📰 Actualités", "━━ ACTUALITÉS ━━", "actu-alité"] {
            assert!(is_excluded(&d, "1", name), "{name}");
            assert!(default_excluded(name), "{name}");
        }
        for name in ["Général", "actualités-jeux", "actu", "", "📰"] {
            assert!(!is_excluded(&d, "1", name), "{name}");
        }
    }

    #[test]
    fn exclusion_by_id_or_name() {
        let r = rules(&["123456789012345678", "  Hors sujet ", ""]);
        assert!(is_excluded(&r, "123456789012345678", "n'importe"));
        assert!(!is_excluded(&r, "123456789012345679", "n'importe"));
        assert!(is_excluded(&r, "1", "hors-sujet"));
        assert!(is_excluded(&r, "1", "HORS SUJETS"));
        assert!(!is_excluded(&[], "1", "actualités"), "liste vide : rien d'exclu");
        assert!(!rule_matches("   ", "", ""));
        assert_eq!(fold_name("Œuvres"), "oeuvre");
        assert_eq!(fold_name("s"), "s");
    }

    #[test]
    fn validation() {
        assert!(validate_guild_id(" 123456789012345678 ").is_ok());
        assert!(validate_guild_id("1234").is_err());
        assert!(validate_guild_id("12345678901234567x").is_err());
        assert!(validate_guild_id("99999999999999999999999").is_err());
        let tok = format!("{}.{}.{}", "M".repeat(26), "G1ab2c", "x".repeat(38));
        assert_eq!(normalize_token(&format!("Bot {tok}")).unwrap(), tok);
        assert!(normalize_token("abc").is_err());
        assert!(normalize_token(&format!("{tok}\nX")).is_err());
        assert!(normalize_token(&tok.replace('.', "")).is_err());
        assert_eq!(validate_interval(24), Ok(24));
        assert_eq!(validate_interval(48), Ok(48));
        assert!(validate_interval(12).is_err());
        assert_eq!(validate_excluded(&rules(&[" a ", "a", "", "b"])).unwrap(), rules(&["a", "b"]));
        assert!(validate_excluded(&rules(&[&"x".repeat(101)])).is_err());
        let many: Vec<String> = (0..51).map(|i| i.to_string()).collect();
        assert!(validate_excluded(&many).is_err());
    }

    #[test]
    fn initial_cursor_prefers_stored_then_last_import() {
        let t = Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap();
        assert_eq!(initial_cursor(Some("42"), Some(t)), 42);
        assert_eq!(initial_cursor(None, None), 0);
        assert_eq!(initial_cursor(Some("pas un nombre"), None), 0);
        let c = initial_cursor(None, Some(t));
        // Un message posté dans la même milliseconde est déjà importé ; la suivante non.
        let same_ms = ((t.timestamp_millis() - DISCORD_EPOCH_MS) as u64) << 22 | 5;
        let next_ms = ((t.timestamp_millis() + 1 - DISCORD_EPOCH_MS) as u64) << 22;
        assert!(same_ms <= c && next_ms > c);
        assert_eq!(snowflake_at(Utc.timestamp_millis_opt(0).unwrap()), (1 << 22) - 1);
    }

    #[test]
    fn page_step_is_incremental_and_idempotent() {
        // Discord renvoie la page du plus récent au plus ancien.
        let s = page_step(10, vec![13u64, 12, 11, 12, 9, 10], |m| *m);
        assert_eq!(s, PageStep { fresh: vec![11, 12, 13], cursor: 13, more: false });
        // Rejouer la même page avec le nouveau curseur n'importe rien (pas de doublon).
        let again = page_step(s.cursor, vec![13u64, 12, 11], |m| *m);
        assert!(again.fresh.is_empty());
        assert_eq!(again.cursor, 13);
        // Page pleine : il peut y avoir une suite.
        let full: Vec<u64> = (1..=PAGE as u64).rev().collect();
        let s = page_step(0, full, |m| *m);
        assert!(s.more);
        assert_eq!(s.cursor, PAGE as u64);
        assert_eq!(s.fresh.first(), Some(&1));
        // Page pleine sans progrès : arrêt.
        let stale = vec![5u64; PAGE];
        let s = page_step(5, stale, |m| *m);
        assert!(!s.more && s.fresh.is_empty() && s.cursor == 5);
        // Page vide : curseur inchangé.
        let s = page_step(7, Vec::<u64>::new(), |m| *m);
        assert_eq!(s, PageStep { fresh: vec![], cursor: 7, more: false });
    }
}
