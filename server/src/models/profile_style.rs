//! Personnalisation du pseudo et du profil (gratuite pour tous) : nom d'affichage,
//! style du pseudo (couleur unie ou dégradé, effet, police), étiquette perso et liens.
//! Tout est validé ici par liste blanche ; le client ne reçoit jamais de CSS brut,
//! seulement des couleurs 0xRRGGBB et des identifiants qu'il traduit lui-même.

use serde::{Deserialize, Serialize};

pub const NAME_EFFECTS: &[&str] = &["", "shimmer", "glow", "outline"];
pub const NAME_FONTS: &[&str] = &["", "serif", "mono", "rounded", "heavy", "cursive"];
pub const DISPLAY_NAME_MAX: usize = 32;
pub const TAG_MAX: usize = 16;
pub const LINKS_MAX: usize = 5;
pub const LINK_LABEL_MAX: usize = 32;
pub const LINK_URL_MAX: usize = 256;
/// Durées proposées pour effacer le statut personnalisé (minutes ; 0 = jamais).
pub const STATUS_CLEAR_AFTER: &[i64] = &[0, 30, 60, 240, 1440, 4320, 10080];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NameStyle {
    /// 0 couleur = couleur par défaut, 1 = unie, 2-3 = dégradé.
    #[serde(default)]
    pub colors: Vec<u32>,
    #[serde(default = "default_angle")]
    pub angle: u16,
    #[serde(default)]
    pub effect: String,
    #[serde(default)]
    pub font: String,
}

fn default_angle() -> u16 {
    90
}

impl NameStyle {
    fn is_default(&self) -> bool {
        self.colors.is_empty() && self.effect.is_empty() && self.font.is_empty()
    }
}

/// `null` ou style vide → None (style par défaut) ; sinon le style normalisé à stocker.
pub fn parse_name_style(v: &serde_json::Value) -> Result<Option<serde_json::Value>, &'static str> {
    if v.is_null() {
        return Ok(None);
    }
    let s: NameStyle = serde_json::from_value(v.clone()).map_err(|_| "Style du pseudo invalide")?;
    if s.colors.len() > 3 || s.colors.iter().any(|&c| c > 0xFF_FFFF) {
        return Err("Style du pseudo : 3 couleurs 0xRRGGBB au plus");
    }
    if s.angle > 360 {
        return Err("Style du pseudo : angle 0-360");
    }
    if !NAME_EFFECTS.contains(&s.effect.as_str()) || !NAME_FONTS.contains(&s.font.as_str()) {
        return Err("Style du pseudo : effet ou police inconnus");
    }
    if s.is_default() {
        return Ok(None);
    }
    Ok(Some(serde_json::to_value(s).map_err(|_| "Style du pseudo invalide")?))
}

/// Caractères refusés dans un nom visible : contrôle, invisibles (largeur nulle) et
/// inversions bidi qui servent à usurper un autre pseudo ou à casser l'affichage.
fn sneaky(c: char) -> bool {
    c.is_control()
        || matches!(c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{2069}' | '\u{FEFF}' | '\u{3164}' | '\u{115F}' | '\u{1160}' | '\u{FFA0}')
}

/// Texte court affiché (nom d'affichage, étiquette) : rogné ; vide → None (effacer).
pub fn clean_label(s: &str, max: usize, what: &'static str) -> Result<Option<String>, String> {
    let s = s.trim();
    if s.is_empty() {
        return Ok(None);
    }
    if s.chars().count() > max {
        return Err(format!("{what} : {max} caractères max"));
    }
    if s.chars().any(sneaky) {
        return Err(format!("{what} : caractères invisibles ou de contrôle interdits"));
    }
    Ok(Some(s.to_string()))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ProfileLink {
    pub label: String,
    pub url: String,
}

/// Liens du profil : 5 au plus, https uniquement, sans identifiants dans l'adresse.
/// `[]` ou `null` → None (aucun lien).
pub fn parse_links(v: &serde_json::Value) -> Result<Option<serde_json::Value>, String> {
    if v.is_null() {
        return Ok(None);
    }
    let links: Vec<ProfileLink> = serde_json::from_value(v.clone()).map_err(|_| "Liens invalides".to_string())?;
    if links.len() > LINKS_MAX {
        return Err(format!("{LINKS_MAX} liens max"));
    }
    let mut out = Vec::with_capacity(links.len());
    for l in links {
        let label = clean_label(&l.label, LINK_LABEL_MAX, "Nom du lien")?.ok_or("Nom du lien vide")?;
        let url = l.url.trim();
        if url.len() > LINK_URL_MAX {
            return Err(format!("Lien : {LINK_URL_MAX} caractères max"));
        }
        let parsed = reqwest::Url::parse(url).map_err(|_| "Lien invalide".to_string())?;
        if parsed.scheme() != "https" || parsed.host_str().is_none_or(|h| h.is_empty())
            || !parsed.username().is_empty() || parsed.password().is_some()
        {
            return Err("Lien : adresse https:// uniquement".into());
        }
        out.push(ProfileLink { label, url: parsed.to_string() });
    }
    if out.is_empty() {
        return Ok(None);
    }
    serde_json::to_value(out).map(Some).map_err(|_| "Liens invalides".into())
}

/// Bannière envoyée par PATCH /users/me : seulement "" (retirer) ou un fichier déjà
/// téléversé par /users/me/banner. Avant, n'importe quelle chaîne était stockée telle
/// quelle (adresse externe de pistage, `javascript:`…).
pub fn valid_banner_ref(s: &str) -> bool {
    s.is_empty()
        || (s.starts_with("/uploads/banners/")
            && !s.contains("..")
            && s["/uploads/banners/".len()..].chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn style_valide_et_normalise() {
        assert_eq!(parse_name_style(&json!(null)).unwrap(), None);
        assert_eq!(parse_name_style(&json!({})).unwrap(), None);
        let s = parse_name_style(&json!({ "colors": [0xff0000, 0x00ff00], "angle": 45, "effect": "shimmer", "font": "serif" })).unwrap().unwrap();
        assert_eq!(s["angle"], 45);
        assert_eq!(parse_name_style(&json!({ "colors": [0x123456] })).unwrap().unwrap()["angle"], 90);
    }

    #[test]
    fn style_refuse_css_et_bornes() {
        assert!(parse_name_style(&json!({ "colors": [0x1000000] })).is_err());
        assert!(parse_name_style(&json!({ "colors": [1, 2, 3, 4] })).is_err());
        assert!(parse_name_style(&json!({ "colors": ["red"] })).is_err());
        assert!(parse_name_style(&json!({ "colors": [-1] })).is_err());
        assert!(parse_name_style(&json!({ "angle": 400 })).is_err());
        assert!(parse_name_style(&json!({ "font": "Comic; background:url(x)" })).is_err());
        assert!(parse_name_style(&json!({ "effect": "blink" })).is_err());
        assert!(parse_name_style(&json!({ "css": "color:red" })).is_err());
        assert!(parse_name_style(&json!("color:red")).is_err());
    }

    #[test]
    fn libelles() {
        assert_eq!(clean_label("  Momo ✨ ", 32, "Nom").unwrap(), Some("Momo ✨".into()));
        assert_eq!(clean_label("   ", 32, "Nom").unwrap(), None);
        assert!(clean_label(&"é".repeat(33), 32, "Nom").is_err());
        assert!(clean_label("ad\u{202E}nim", 32, "Nom").is_err());
        assert!(clean_label("a\u{200B}b", 32, "Nom").is_err());
        assert!(clean_label("a\nb", 32, "Nom").is_err());
        assert!(clean_label("\u{3164}", 32, "Nom").is_err());
    }

    #[test]
    fn liens_https_seulement() {
        let ok = parse_links(&json!([{ "label": "Site", "url": "https://heiphaistos.org/a?b=1" }])).unwrap().unwrap();
        assert_eq!(ok[0]["url"], "https://heiphaistos.org/a?b=1");
        assert_eq!(parse_links(&json!([])).unwrap(), None);
        assert_eq!(parse_links(&json!(null)).unwrap(), None);
        for bad in ["http://a.fr", "javascript:alert(1)", "data:text/html,x", "https://user:pw@a.fr", "ftp://a.fr", "https://"] {
            assert!(parse_links(&json!([{ "label": "x", "url": bad }])).is_err(), "{bad}");
        }
        assert!(parse_links(&json!([{ "label": "", "url": "https://a.fr" }])).is_err());
        let six: Vec<_> = (0..6).map(|i| json!({ "label": format!("l{i}"), "url": "https://a.fr" })).collect();
        assert!(parse_links(&json!(six)).is_err());
        assert!(parse_links(&json!([{ "label": "x", "url": "https://a.fr", "onclick": "x" }])).is_err());
    }

    #[test]
    fn banniere_seulement_un_fichier_local() {
        assert!(valid_banner_ref(""));
        assert!(valid_banner_ref("/uploads/banners/a_0b1c-2d.gif"));
        assert!(!valid_banner_ref("https://evil.example/pixel.gif"));
        assert!(!valid_banner_ref("/uploads/banners/../avatars/x.png"));
        assert!(!valid_banner_ref("/uploads/banners/x.png?<script>"));
        assert!(!valid_banner_ref("javascript:alert(1)"));
    }
}
