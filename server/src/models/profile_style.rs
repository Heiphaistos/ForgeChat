//! Personnalisation du pseudo et du profil (gratuite pour tous) : nom d'affichage,
//! style du pseudo (couleur unie ou dégradé, effet, police), étiquette perso et liens.
//! Tout est validé ici par liste blanche ; le client ne reçoit jamais de CSS brut,
//! seulement des couleurs 0xRRGGBB et des identifiants qu'il traduit lui-même.

use serde::{Deserialize, Serialize};

/// Effets du pseudo (rendu web : lib/nameStyle.ts ; mobile : lib/nameStyle.ts).
pub const NAME_EFFECTS: &[&str] = &[
    "", "shimmer", "glow", "outline", "neon", "rainbow", "wave", "glitch", "shadow3d",
    "fire", "frost", "pulse", "holo", "chrome", "retro", "float", "sparkle",
];
/// Polices du pseudo : piles de polices système / embarquées, aucune police téléchargée.
pub const NAME_FONTS: &[&str] = &[
    "", "serif", "mono", "rounded", "heavy", "cursive", "slab", "condensed", "wide", "elegant",
    "typewriter", "gothic", "comic", "impact", "smallcaps", "light", "handwritten", "futuristic",
    "retro", "stencil", "code", "italic",
];
/// Épaisseur maximale du contour du pseudo (px).
pub const OUTLINE_WIDTH_MAX: u8 = 4;
/// Habillage d'une marque de clan (étiquette perso ou tag de serveur).
pub const TAG_BADGES: &[&str] = &["", "solid", "soft", "outline", "gradient", "glass", "pill", "neon", "plain"];
/// Icônes de marque : identifiants traduits en caractères par le client, jamais du texte libre.
pub const TAG_ICONS: &[&str] = &[
    "", "star", "crown", "shield", "flame", "bolt", "heart", "skull", "leaf", "diamond",
    "moon", "sword", "gem", "paw", "music", "gamepad",
];
/// Anneau d'avatar du profil de serveur (rendu web : components/ui/AvatarRing.tsx ;
/// mobile : components/AvatarRing.tsx, même liste).
pub const RING_STYLES: &[&str] = &[
    "solid", "dashed", "dotted", "double", "glow", "spin", "pulse",
    "gradient_spin", "rainbow", "dashed_spin", "neon_pulse", "comet", "segmented", "breathe",
];
pub const RING_WIDTH_MAX: u8 = 8;
/// Sens de rotation (anneau et décoration d'avatar).
pub const DIRECTIONS: &[&str] = &["cw", "ccw"];
/// Bornes des réglages en % (ou en degrés pour la teinte), partagées par l'anneau et la décoration.
pub const SPEED_RANGE: std::ops::RangeInclusive<u16> = 25..=400;
pub const BRIGHTNESS_RANGE: std::ops::RangeInclusive<u16> = 50..=200;
pub const SATURATION_RANGE: std::ops::RangeInclusive<u16> = 0..=200;
pub const GLOW_RANGE: std::ops::RangeInclusive<u16> = 0..=300;
pub const OPACITY_RANGE: std::ops::RangeInclusive<u16> = 20..=100;
pub const HUE_RANGE: std::ops::RangeInclusive<u16> = 0..=360;
pub const SCALE_RANGE: std::ops::RangeInclusive<u16> = 80..=130;
pub const DISPLAY_NAME_MAX: usize = 32;
pub const TAG_MAX: usize = 16;
pub const LINKS_MAX: usize = 5;
pub const LINK_LABEL_MAX: usize = 32;
pub const LINK_URL_MAX: usize = 256;
/// Durées proposées pour effacer le statut personnalisé (minutes ; 0 = jamais).
pub const STATUS_CLEAR_AFTER: &[i64] = &[0, 30, 60, 240, 1440, 4320, 10080];

const COLOR_MAX: u32 = 0xFF_FFFF;

fn is_zero(v: &u8) -> bool {
    *v == 0
}

fn hundred() -> u16 {
    100
}
fn is_hundred(v: &u16) -> bool {
    *v == 100
}
fn is_zero16(v: &u16) -> bool {
    *v == 0
}
fn yes() -> bool {
    true
}
fn is_true(v: &bool) -> bool {
    *v
}
fn is_false(v: &bool) -> bool {
    !*v
}
fn cw() -> String {
    "cw".into()
}
fn is_cw(v: &String) -> bool {
    v == "cw"
}

/// Style d'une marque de clan : couleur (étiquette perso seulement ; un tag de serveur
/// garde sa colonne `color`), seconde couleur (dégradé), police, fond et icône.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TagStyle {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color2: Option<u32>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub font: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub badge: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub icon: String,
}

impl TagStyle {
    fn check(&self) -> Result<(), &'static str> {
        if self.color.is_some_and(|c| c > COLOR_MAX) || self.color2.is_some_and(|c| c > COLOR_MAX) {
            return Err("Marque : couleurs 0xRRGGBB");
        }
        if !NAME_FONTS.contains(&self.font.as_str())
            || !TAG_BADGES.contains(&self.badge.as_str())
            || !TAG_ICONS.contains(&self.icon.as_str())
        {
            return Err("Marque : police, fond ou icône inconnus");
        }
        Ok(())
    }

    fn is_default(&self) -> bool {
        *self == TagStyle::default()
    }
}

/// Style d'un tag de serveur (`server_tags.style`) : `null` ou `{}` → None. La couleur
/// principale reste la colonne `color`, refusée ici pour n'avoir qu'une source.
pub fn parse_tag_style(v: &serde_json::Value) -> Result<Option<serde_json::Value>, &'static str> {
    if v.is_null() {
        return Ok(None);
    }
    let s: TagStyle = serde_json::from_value(v.clone()).map_err(|_| "Style de marque invalide")?;
    s.check()?;
    if s.color.is_some() {
        return Err("Style de marque : la couleur principale se règle à part");
    }
    if s.is_default() {
        return Ok(None);
    }
    serde_json::to_value(s).map(Some).map_err(|_| "Style de marque invalide")
}

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
    /// Couleur du contour (0xRRGGBB) ; sans épaisseur, pas de contour.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outline: Option<u32>,
    /// Épaisseur du contour en px (0 = aucun, OUTLINE_WIDTH_MAX au plus).
    #[serde(default, skip_serializing_if = "is_zero")]
    pub outline_width: u8,
    /// Style de l'étiquette perso affichée à côté du pseudo.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tag: Option<TagStyle>,
}

fn default_angle() -> u16 {
    90
}

impl NameStyle {
    fn is_default(&self) -> bool {
        self.colors.is_empty() && self.effect.is_empty() && self.font.is_empty()
            && self.outline_width == 0 && self.tag.is_none()
    }
}

/// `null` ou style vide → None (style par défaut) ; sinon le style normalisé à stocker.
pub fn parse_name_style(v: &serde_json::Value) -> Result<Option<serde_json::Value>, &'static str> {
    if v.is_null() {
        return Ok(None);
    }
    let mut s: NameStyle = serde_json::from_value(v.clone()).map_err(|_| "Style du pseudo invalide")?;
    if s.colors.len() > 3 || s.colors.iter().any(|&c| c > COLOR_MAX) {
        return Err("Style du pseudo : 3 couleurs 0xRRGGBB au plus");
    }
    if s.angle > 360 {
        return Err("Style du pseudo : angle 0-360");
    }
    if !NAME_EFFECTS.contains(&s.effect.as_str()) || !NAME_FONTS.contains(&s.font.as_str()) {
        return Err("Style du pseudo : effet ou police inconnus");
    }
    if s.outline_width > OUTLINE_WIDTH_MAX || s.outline.is_some_and(|c| c > COLOR_MAX) {
        return Err("Style du pseudo : contour 0xRRGGBB, épaisseur 0-4");
    }
    // Contour normalisé : pas d'épaisseur → pas de couleur ; épaisseur sans couleur → noir.
    if s.outline_width == 0 {
        s.outline = None;
    } else if s.outline.is_none() {
        s.outline = Some(0);
    }
    if let Some(tag) = &s.tag {
        tag.check()?;
        if tag.is_default() {
            s.tag = None;
        }
    }
    if s.is_default() {
        return Ok(None);
    }
    Ok(Some(serde_json::to_value(s).map_err(|_| "Style du pseudo invalide")?))
}

/// Anneau autour de l'avatar dans un serveur (profil de serveur).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AvatarRing {
    /// 1 couleur = unie, 2-3 = dégradé ; aucune = pas d'anneau.
    #[serde(default)]
    pub colors: Vec<u32>,
    #[serde(default = "default_ring_width")]
    pub width: u8,
    #[serde(default)]
    pub style: String,
    /// Vitesse des animations en % (SPEED_RANGE).
    #[serde(default = "hundred", skip_serializing_if = "is_hundred")]
    pub speed: u16,
    /// "cw" (horaire) ou "ccw".
    #[serde(default = "cw", skip_serializing_if = "is_cw")]
    pub direction: String,
    /// Luminosité en % (BRIGHTNESS_RANGE).
    #[serde(default = "hundred", skip_serializing_if = "is_hundred")]
    pub brightness: u16,
    /// Intensité de la lueur en % (GLOW_RANGE).
    #[serde(default = "hundred", skip_serializing_if = "is_hundred")]
    pub glow: u16,
}

fn default_ring_width() -> u8 {
    3
}

/// Réglages de la décoration d'avatar (`users.avatar_decoration_opts`). Seulement des
/// nombres bornés, des booléens et un sens connu : le client en tire des variables CSS
/// numériques (jamais une chaîne de l'utilisateur dans le CSS). Les valeurs par défaut ne
/// sont pas stockées ; tout par défaut → NULL.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DecorationOpts {
    #[serde(default = "yes", skip_serializing_if = "is_true")]
    pub animate: bool,
    #[serde(default = "cw", skip_serializing_if = "is_cw")]
    pub direction: String,
    #[serde(default = "hundred", skip_serializing_if = "is_hundred")]
    pub speed: u16,
    #[serde(default, skip_serializing_if = "is_false")]
    pub pulse: bool,
    #[serde(default = "hundred", skip_serializing_if = "is_hundred")]
    pub brightness: u16,
    #[serde(default = "hundred", skip_serializing_if = "is_hundred")]
    pub saturation: u16,
    #[serde(default = "hundred", skip_serializing_if = "is_hundred")]
    pub glow: u16,
    #[serde(default = "hundred", skip_serializing_if = "is_hundred")]
    pub opacity: u16,
    /// Décalage de teinte en degrés.
    #[serde(default, skip_serializing_if = "is_zero16")]
    pub hue: u16,
    /// Taille de la décoration en %.
    #[serde(default = "hundred", skip_serializing_if = "is_hundred")]
    pub scale: u16,
    /// Couleur de teinte 0xRRGGBB (mélangée aux couleurs de la décoration).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tint: Option<u32>,
}

impl Default for DecorationOpts {
    fn default() -> Self {
        Self {
            animate: true, direction: cw(), speed: 100, pulse: false, brightness: 100,
            saturation: 100, glow: 100, opacity: 100, hue: 0, scale: 100, tint: None,
        }
    }
}

/// Taille maximale du JSON stocké (même borne que la contrainte de la migration 134).
pub const DECORATION_OPTS_MAX_BYTES: usize = 512;

/// `null`, `{}` ou réglages par défaut → None ; sinon les réglages normalisés à stocker.
/// Refuse tout champ inconnu, toute valeur hors bornes, non entière ou d'un autre type.
pub fn parse_decoration_opts(v: &serde_json::Value) -> Result<Option<serde_json::Value>, &'static str> {
    if v.is_null() {
        return Ok(None);
    }
    let o: DecorationOpts = serde_json::from_value(v.clone()).map_err(|_| "Réglages de décoration invalides")?;
    if !DIRECTIONS.contains(&o.direction.as_str()) {
        return Err("Décoration : sens cw ou ccw");
    }
    let bounds = [
        (o.speed, &SPEED_RANGE, "Décoration : vitesse 25-400 %"),
        (o.brightness, &BRIGHTNESS_RANGE, "Décoration : luminosité 50-200 %"),
        (o.saturation, &SATURATION_RANGE, "Décoration : saturation 0-200 %"),
        (o.glow, &GLOW_RANGE, "Décoration : halo 0-300 %"),
        (o.opacity, &OPACITY_RANGE, "Décoration : opacité 20-100 %"),
        (o.hue, &HUE_RANGE, "Décoration : teinte 0-360°"),
        (o.scale, &SCALE_RANGE, "Décoration : taille 80-130 %"),
    ];
    for (v, range, err) in bounds {
        if !range.contains(&v) {
            return Err(err);
        }
    }
    if o.tint.is_some_and(|c| c > COLOR_MAX) {
        return Err("Décoration : couleur 0xRRGGBB");
    }
    if o == DecorationOpts::default() {
        return Ok(None);
    }
    let out = serde_json::to_value(o).map_err(|_| "Réglages de décoration invalides")?;
    if out.to_string().len() > DECORATION_OPTS_MAX_BYTES {
        return Err("Réglages de décoration trop longs");
    }
    Ok(Some(out))
}

/// `null`, `{}` ou aucune couleur → None (pas d'anneau) ; sinon l'anneau normalisé.
pub fn parse_avatar_ring(v: &serde_json::Value) -> Result<Option<serde_json::Value>, &'static str> {
    if v.is_null() {
        return Ok(None);
    }
    let mut r: AvatarRing = serde_json::from_value(v.clone()).map_err(|_| "Anneau d'avatar invalide")?;
    if r.colors.len() > 3 || r.colors.iter().any(|&c| c > COLOR_MAX) {
        return Err("Anneau d'avatar : 3 couleurs 0xRRGGBB au plus");
    }
    if r.width == 0 || r.width > RING_WIDTH_MAX {
        return Err("Anneau d'avatar : épaisseur 1-8");
    }
    if r.style.is_empty() {
        r.style = "solid".into();
    }
    if !RING_STYLES.contains(&r.style.as_str()) {
        return Err("Anneau d'avatar : style inconnu");
    }
    if !DIRECTIONS.contains(&r.direction.as_str()) {
        return Err("Anneau d'avatar : sens cw ou ccw");
    }
    if !SPEED_RANGE.contains(&r.speed) {
        return Err("Anneau d'avatar : vitesse 25-400 %");
    }
    if !BRIGHTNESS_RANGE.contains(&r.brightness) {
        return Err("Anneau d'avatar : luminosité 50-200 %");
    }
    if !GLOW_RANGE.contains(&r.glow) {
        return Err("Anneau d'avatar : lueur 0-300 %");
    }
    if r.colors.is_empty() {
        return Ok(None);
    }
    serde_json::to_value(r).map(Some).map_err(|_| "Anneau d'avatar invalide")
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
    fn style_contour_et_marque() {
        let s = parse_name_style(&json!({ "font": "gothic", "effect": "glitch", "outline": 0xffffff, "outline_width": 2 })).unwrap().unwrap();
        assert_eq!(s["outline"], 0xffffff);
        assert_eq!(s["outline_width"], 2);
        // Épaisseur sans couleur : contour noir ; couleur sans épaisseur : retirée.
        assert_eq!(parse_name_style(&json!({ "outline_width": 1 })).unwrap().unwrap()["outline"], 0);
        assert_eq!(parse_name_style(&json!({ "outline": 0xff0000 })).unwrap(), None);
        assert!(parse_name_style(&json!({ "outline_width": 5 })).is_err());
        assert!(parse_name_style(&json!({ "outline_width": -1 })).is_err());
        assert!(parse_name_style(&json!({ "outline": "red", "outline_width": 1 })).is_err());
        assert!(parse_name_style(&json!({ "outline": 0x1000000, "outline_width": 1 })).is_err());
        let t = parse_name_style(&json!({ "tag": { "color": 0x00ff00, "badge": "neon", "icon": "crown", "font": "mono" } })).unwrap().unwrap();
        assert_eq!(t["tag"]["icon"], "crown");
        assert_eq!(parse_name_style(&json!({ "tag": {} })).unwrap(), None);
        assert!(parse_name_style(&json!({ "tag": { "icon": "<img>" } })).is_err());
        assert!(parse_name_style(&json!({ "tag": { "badge": "url(x)" } })).is_err());
        assert!(parse_name_style(&json!({ "tag": { "style": "color:red" } })).is_err());
        assert!(parse_name_style(&json!({ "tag": { "color2": 0x1000000 } })).is_err());
        for e in NAME_EFFECTS { assert!(parse_name_style(&json!({ "effect": e })).is_ok()); }
        for f in NAME_FONTS { assert!(parse_name_style(&json!({ "font": f })).is_ok()); }
        assert!(NAME_EFFECTS.len() > 12 && NAME_FONTS.len() > 15);
    }

    #[test]
    fn style_de_tag_de_serveur() {
        assert_eq!(parse_tag_style(&json!(null)).unwrap(), None);
        assert_eq!(parse_tag_style(&json!({})).unwrap(), None);
        assert_eq!(parse_tag_style(&json!({ "badge": "glass", "color2": 0x123456 })).unwrap().unwrap()["badge"], "glass");
        assert!(parse_tag_style(&json!({ "color": 0x123456 })).is_err());
        assert!(parse_tag_style(&json!({ "font": "Arial" })).is_err());
        assert!(parse_tag_style(&json!("solid")).is_err());
    }

    #[test]
    fn anneau_d_avatar() {
        assert_eq!(parse_avatar_ring(&json!(null)).unwrap(), None);
        assert_eq!(parse_avatar_ring(&json!({})).unwrap(), None);
        let r = parse_avatar_ring(&json!({ "colors": [0xff00ff, 0x00ffff], "width": 4 })).unwrap().unwrap();
        assert_eq!(r["style"], "solid");
        assert_eq!(parse_avatar_ring(&json!({ "colors": [1], "style": "spin" })).unwrap().unwrap()["width"], 3);
        assert!(parse_avatar_ring(&json!({ "colors": [1], "width": 0 })).is_err());
        assert!(parse_avatar_ring(&json!({ "colors": [1], "width": 9 })).is_err());
        assert!(parse_avatar_ring(&json!({ "colors": [1, 2, 3, 4] })).is_err());
        assert!(parse_avatar_ring(&json!({ "colors": [0x1000000] })).is_err());
        assert!(parse_avatar_ring(&json!({ "colors": [1], "style": "solid;background:url(x)" })).is_err());
        assert!(parse_avatar_ring(&json!({ "colors": [1], "css": "x" })).is_err());
    }

    #[test]
    fn anneau_styles_et_reglages() {
        for s in RING_STYLES {
            assert_eq!(parse_avatar_ring(&json!({ "colors": [1], "style": s })).unwrap().unwrap()["style"], *s);
        }
        let r = parse_avatar_ring(&json!({ "colors": [1, 2], "style": "comet", "speed": 250, "direction": "ccw", "brightness": 150, "glow": 0 })).unwrap().unwrap();
        assert_eq!((r["speed"].as_u64(), r["direction"].as_str(), r["brightness"].as_u64(), r["glow"].as_u64()), (Some(250), Some("ccw"), Some(150), Some(0)));
        // Valeurs par défaut non stockées.
        let d = parse_avatar_ring(&json!({ "colors": [1], "speed": 100, "direction": "cw", "brightness": 100, "glow": 100 })).unwrap().unwrap();
        assert!(d.get("speed").is_none() && d.get("direction").is_none() && d.get("brightness").is_none() && d.get("glow").is_none());
        for bad in [
            json!({ "colors": [1], "speed": 24 }), json!({ "colors": [1], "speed": 401 }),
            json!({ "colors": [1], "speed": 1.5 }), json!({ "colors": [1], "speed": "fast" }),
            json!({ "colors": [1], "direction": "left" }), json!({ "colors": [1], "direction": "" }),
            json!({ "colors": [1], "brightness": 49 }), json!({ "colors": [1], "brightness": 201 }),
            json!({ "colors": [1], "glow": 301 }), json!({ "colors": [1], "glow": -1 }),
            json!({ "colors": [1], "style": "gradient-spin" }),
        ] {
            assert!(parse_avatar_ring(&bad).is_err(), "{bad}");
        }
        // Pire cas sous la contrainte server_members_ring_size (256 octets).
        let max = parse_avatar_ring(&json!({ "colors": [0xffffff, 0xffffff, 0xffffff], "width": 8, "style": "gradient_spin", "speed": 400, "direction": "ccw", "brightness": 200, "glow": 300 })).unwrap().unwrap();
        assert!(max.to_string().len() <= 256, "{}", max.to_string().len());
    }

    #[test]
    fn reglages_de_decoration() {
        assert_eq!(parse_decoration_opts(&json!(null)).unwrap(), None);
        assert_eq!(parse_decoration_opts(&json!({})).unwrap(), None);
        // Tout par défaut, même écrit en entier : rien à stocker.
        let defaults = json!({ "animate": true, "direction": "cw", "speed": 100, "pulse": false, "brightness": 100, "saturation": 100, "glow": 100, "opacity": 100, "hue": 0, "scale": 100 });
        assert_eq!(parse_decoration_opts(&defaults).unwrap(), None);
        let o = parse_decoration_opts(&json!({ "animate": false, "direction": "ccw", "speed": 400, "pulse": true, "brightness": 50, "saturation": 0, "glow": 300, "opacity": 20, "hue": 360, "scale": 130, "tint": 0xff00ff })).unwrap().unwrap();
        assert_eq!(o["animate"], false);
        assert_eq!(o["direction"], "ccw");
        assert_eq!(o["tint"], 0xff00ff);
        assert!(o.to_string().len() <= DECORATION_OPTS_MAX_BYTES);
        // Seuls les champs modifiés sont gardés.
        assert_eq!(parse_decoration_opts(&json!({ "hue": 90, "speed": 100 })).unwrap().unwrap(), json!({ "hue": 90 }));
        assert_eq!(parse_decoration_opts(&json!({ "scale": 80 })).unwrap().unwrap(), json!({ "scale": 80 }));
    }

    #[test]
    fn reglages_de_decoration_refuses() {
        for bad in [
            json!({ "speed": 24 }), json!({ "speed": 401 }), json!({ "speed": 1.5 }), json!({ "speed": -10 }),
            json!({ "brightness": 49 }), json!({ "brightness": 201 }),
            json!({ "saturation": 201 }), json!({ "glow": 301 }),
            json!({ "opacity": 19 }), json!({ "opacity": 101 }),
            json!({ "hue": 361 }), json!({ "scale": 79 }), json!({ "scale": 131 }),
            json!({ "tint": 0x1000000 }), json!({ "tint": "#ff0000" }), json!({ "tint": -1 }),
            json!({ "direction": "left" }), json!({ "direction": "cw;color:red" }),
            json!({ "animate": "yes" }), json!({ "pulse": 1 }),
            json!({ "css": "color:red" }), json!({ "speed": 100, "extra": 1 }),
            json!("hue-rotate(90deg)"), json!([1, 2]), json!(42),
        ] {
            assert!(parse_decoration_opts(&bad).is_err(), "{bad}");
        }
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
