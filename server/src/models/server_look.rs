//! Apparence d'un serveur (colonne `servers.look`, migration 135) : bannière (cadrage,
//! hauteur, voile), couleurs d'accent, fonds de la liste des salons et de la zone des
//! messages, style du nom, forme et anneau de l'icône, écran d'accueil, couleur des
//! non-lus, affichage des couleurs de rôle, et « imposer à tous les membres ».
//!
//! Validation stricte : champs inconnus refusés, identifiants en liste blanche, couleurs
//! 0xRRGGBB (entiers), nombres ramenés dans leurs bornes, images seulement parmi les
//! fichiers envoyés par le serveur lui-même (`/uploads/server-banners/…`). Le client ne
//! reçoit jamais de CSS : il traduit ces identifiants et ces nombres lui-même
//! (web : client/src/lib/serverLook.ts ; mobile : mobile/src/features/servers/serverLook.ts).

use serde::{Deserialize, Serialize};

use super::profile_style::{NAME_EFFECTS, NAME_FONTS};

pub const COLOR_MAX: u32 = 0xFF_FFFF;
pub const BANNER_HEIGHTS: &[&str] = &["auto", "full", "compact"];
pub const BANNER_OVERLAYS: &[&str] = &["none", "bottom", "top", "full", "vignette", "accent"];
pub const BG_KINDS: &[&str] = &["none", "color", "gradient", "pattern", "image"];
pub const BG_PATTERNS: &[&str] = &["dots", "grid", "diagonal", "checker", "cross", "waves", "zigzag", "stripes"];
pub const ICON_SHAPES: &[&str] = &["circle", "squircle", "square", "hexagon"];
pub const ICON_RINGS: &[&str] = &["none", "solid", "glow"];
pub const WELCOME_STYLES: &[&str] = &["classic", "centered", "card", "minimal"];
pub const ROLE_DISPLAYS: &[&str] = &["name", "dot", "badge"];
pub const BLUR_MAX: i64 = 24;
/// Dossier des images de l'apparence (le même que les bannières de serveur, déjà public).
pub const IMAGE_PREFIX: &str = "/uploads/server-banners/";

fn clamp(v: i64, min: i64, max: i64) -> i64 {
    v.clamp(min, max)
}

fn in_list(list: &[&str], v: &str) -> bool {
    list.contains(&v)
}

fn color_ok(c: Option<u32>) -> bool {
    c.is_none_or(|c| c <= COLOR_MAX)
}

/// Image envoyée par POST /servers/:id/look/image ou /servers/:id/banner : nom généré par
/// le serveur (uuid, préfixe `a_` si animée), extension d'image connue, rien d'autre.
pub fn valid_image_ref(s: &str) -> bool {
    let Some(name) = s.strip_prefix(IMAGE_PREFIX) else { return false };
    let Some((stem, ext)) = name.rsplit_once('.') else { return false };
    !stem.is_empty()
        && stem.len() <= 64
        && stem.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        && matches!(ext, "png" | "jpg" | "gif" | "webp")
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BannerLook {
    /// Point d'ancrage de l'image entière dans son cadre (0-100 %).
    #[serde(default = "fifty")]
    pub focus_x: i64,
    #[serde(default = "fifty")]
    pub focus_y: i64,
    #[serde(default = "auto")]
    pub height: String,
    #[serde(default = "bottom")]
    pub overlay: String,
    /// Force du voile (0-100).
    #[serde(default = "sixty")]
    pub overlay_strength: i64,
}

fn fifty() -> i64 { 50 }
fn sixty() -> i64 { 60 }
fn auto() -> String { "auto".into() }
fn bottom() -> String { "bottom".into() }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Background {
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color2: Option<u32>,
    #[serde(default = "angle135")]
    pub angle: i64,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub pattern: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub image: String,
    /// Opacité du calque (0-100).
    #[serde(default = "hundred")]
    pub opacity: i64,
    /// Flou de l'image en px (0-BLUR_MAX).
    #[serde(default)]
    pub blur: i64,
}

fn angle135() -> i64 { 135 }
fn hundred() -> i64 { 100 }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NameLook {
    #[serde(default)]
    pub colors: Vec<u32>,
    #[serde(default = "angle90")]
    pub angle: i64,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub font: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub effect: String,
}

fn angle90() -> i64 { 90 }

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ServerLook {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub banner: Option<BannerLook>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accent: Option<u32>,
    /// Seconde couleur : dégradé d'accent (en-tête, boutons du serveur).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accent2: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sidebar_bg: Option<Background>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_bg: Option<Background>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<NameLook>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub icon_shape: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub icon_ring: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_ring_color: Option<u32>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub welcome: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unread_color: Option<u32>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub role_display: String,
    /// Vrai : imposé à tous ; faux : chaque membre peut l'ignorer chez lui.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub enforce: bool,
}

type R<T> = std::result::Result<T, &'static str>;

impl BannerLook {
    fn normalize(mut self) -> R<Option<Self>> {
        if !in_list(BANNER_HEIGHTS, &self.height) || !in_list(BANNER_OVERLAYS, &self.overlay) {
            return Err("Bannière : hauteur ou voile inconnus");
        }
        self.focus_x = clamp(self.focus_x, 0, 100);
        self.focus_y = clamp(self.focus_y, 0, 100);
        self.overlay_strength = clamp(self.overlay_strength, 0, 100);
        let default = BannerLook { focus_x: 50, focus_y: 50, height: auto(), overlay: bottom(), overlay_strength: 60 };
        Ok((self != default).then_some(self))
    }
}

impl Background {
    fn normalize(mut self) -> R<Option<Self>> {
        if !in_list(BG_KINDS, &self.kind) {
            return Err("Fond : type inconnu");
        }
        if !color_ok(self.color) || !color_ok(self.color2) {
            return Err("Fond : couleurs 0xRRGGBB");
        }
        self.angle = clamp(self.angle, 0, 360);
        self.opacity = clamp(self.opacity, 0, 100);
        self.blur = clamp(self.blur, 0, BLUR_MAX);
        match self.kind.as_str() {
            "none" => return Ok(None),
            "color" => {
                if self.color.is_none() { return Err("Fond uni : couleur requise"); }
                self.color2 = None;
                self.pattern.clear();
                self.image.clear();
            }
            "gradient" => {
                if self.color.is_none() || self.color2.is_none() { return Err("Dégradé : deux couleurs requises"); }
                self.pattern.clear();
                self.image.clear();
            }
            "pattern" => {
                if !in_list(BG_PATTERNS, &self.pattern) { return Err("Motif inconnu"); }
                if self.color.is_none() { return Err("Motif : couleur requise"); }
                self.image.clear();
            }
            _ => {
                if !valid_image_ref(&self.image) {
                    return Err("Image de fond : envoyez-la depuis les paramètres du serveur");
                }
                self.color = None;
                self.color2 = None;
                self.pattern.clear();
            }
        }
        if self.kind != "image" { self.blur = 0; }
        Ok(Some(self))
    }
}

impl NameLook {
    fn normalize(mut self) -> R<Option<Self>> {
        if self.colors.len() > 3 || self.colors.iter().any(|&c| c > COLOR_MAX) {
            return Err("Nom du serveur : 3 couleurs 0xRRGGBB au plus");
        }
        if !in_list(NAME_FONTS, &self.font) || !in_list(NAME_EFFECTS, &self.effect) {
            return Err("Nom du serveur : police ou effet inconnus");
        }
        self.angle = clamp(self.angle, 0, 360);
        Ok((!self.colors.is_empty() || !self.font.is_empty() || !self.effect.is_empty()).then_some(self))
    }
}

impl ServerLook {
    fn normalize(mut self) -> R<Self> {
        for c in [self.accent, self.accent2, self.icon_ring_color, self.unread_color] {
            if !color_ok(c) { return Err("Couleurs 0xRRGGBB attendues"); }
        }
        if self.accent.is_none() { self.accent2 = None; }
        let opt = |list: &[&str], v: &str, default: &str| -> R<String> {
            if v.is_empty() || v == default { Ok(String::new()) }
            else if in_list(list, v) { Ok(v.to_string()) }
            else { Err("Valeur inconnue dans l'apparence du serveur") }
        };
        self.icon_shape = opt(ICON_SHAPES, &self.icon_shape, "circle")?;
        self.icon_ring = opt(ICON_RINGS, &self.icon_ring, "none")?;
        if self.icon_ring.is_empty() { self.icon_ring_color = None; }
        self.welcome = opt(WELCOME_STYLES, &self.welcome, "classic")?;
        self.role_display = opt(ROLE_DISPLAYS, &self.role_display, "name")?;
        self.banner = match self.banner.take() { Some(b) => b.normalize()?, None => None };
        self.sidebar_bg = match self.sidebar_bg.take() { Some(b) => b.normalize()?, None => None };
        self.message_bg = match self.message_bg.take() { Some(b) => b.normalize()?, None => None };
        self.name = match self.name.take() { Some(n) => n.normalize()?, None => None };
        Ok(self)
    }

    fn is_default(&self) -> bool {
        let d = ServerLook { enforce: self.enforce, ..Default::default() };
        *self == d
    }
}

/// `null` ou apparence vide → None (apparence par défaut) ; sinon le document normalisé à stocker.
pub fn parse_server_look(v: &serde_json::Value) -> R<Option<serde_json::Value>> {
    if v.is_null() {
        return Ok(None);
    }
    let look: ServerLook = serde_json::from_value(v.clone()).map_err(|_| "Apparence du serveur invalide")?;
    let look = look.normalize()?;
    if look.is_default() {
        return Ok(None);
    }
    let out = serde_json::to_value(&look).map_err(|_| "Apparence du serveur invalide")?;
    if out.to_string().len() > 4096 {
        return Err("Apparence du serveur trop volumineuse");
    }
    Ok(Some(out))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn null_and_empty_are_default() {
        assert_eq!(parse_server_look(&json!(null)), Ok(None));
        assert_eq!(parse_server_look(&json!({})), Ok(None));
        // Valeurs par défaut explicites : rien à stocker.
        assert_eq!(parse_server_look(&json!({ "icon_shape": "circle", "welcome": "classic", "role_display": "name" })), Ok(None));
        assert_eq!(parse_server_look(&json!({ "banner": { "focus_x": 50 }, "sidebar_bg": { "kind": "none" } })), Ok(None));
    }

    #[test]
    fn unknown_fields_and_ids_refused() {
        assert!(parse_server_look(&json!({ "css": "body{}" })).is_err());
        assert!(parse_server_look(&json!({ "banner": { "height": "auto", "style": "x" } })).is_err());
        assert!(parse_server_look(&json!({ "icon_shape": "star" })).is_err());
        assert!(parse_server_look(&json!({ "welcome": "<script>" })).is_err());
        assert!(parse_server_look(&json!({ "role_display": "rainbow" })).is_err());
        assert!(parse_server_look(&json!({ "banner": { "height": "huge" } })).is_err());
        assert!(parse_server_look(&json!({ "message_bg": { "kind": "pattern", "pattern": "url(x)", "color": 1 } })).is_err());
        assert!(parse_server_look(&json!({ "name": { "font": "Comic; color:red" } })).is_err());
        assert!(parse_server_look(&json!({ "name": { "effect": "explode" } })).is_err());
        assert!(parse_server_look(&json!([1, 2])).is_err());
        assert!(parse_server_look(&json!("dark")).is_err());
    }

    #[test]
    fn colors_are_rgb_integers() {
        assert!(parse_server_look(&json!({ "accent": 0x1000000 })).is_err());
        assert!(parse_server_look(&json!({ "accent": "#ff0000" })).is_err());
        assert!(parse_server_look(&json!({ "accent": -1 })).is_err());
        assert!(parse_server_look(&json!({ "unread_color": 0xFFFFFF + 1 })).is_err());
        assert!(parse_server_look(&json!({ "name": { "colors": [1, 2, 3, 4] } })).is_err());
        let v = parse_server_look(&json!({ "accent": 0xff0000, "accent2": 0x00ff00 })).unwrap().unwrap();
        assert_eq!(v, json!({ "accent": 0xff0000, "accent2": 0x00ff00 }));
        // Sans accent principal, pas de second accent.
        assert_eq!(parse_server_look(&json!({ "accent2": 0x00ff00 })), Ok(None));
    }

    #[test]
    fn numbers_are_clamped() {
        let v = parse_server_look(&json!({
            "banner": { "focus_x": 500, "focus_y": -20, "overlay_strength": 900, "height": "compact" },
            "message_bg": { "kind": "image", "image": "/uploads/server-banners/a_0b1c-2d.gif", "opacity": 300, "blur": 99, "angle": 1000 },
        })).unwrap().unwrap();
        assert_eq!(v["banner"]["focus_x"], 100);
        assert_eq!(v["banner"]["focus_y"], 0);
        assert_eq!(v["banner"]["overlay_strength"], 100);
        assert_eq!(v["message_bg"]["opacity"], 100);
        assert_eq!(v["message_bg"]["blur"], BLUR_MAX);
        assert_eq!(v["message_bg"]["angle"], 360);
    }

    #[test]
    fn images_only_from_own_uploads() {
        for bad in [
            "https://evil.example/x.png",
            "/uploads/avatars/x.png",
            "/uploads/server-banners/../secret.png",
            "/uploads/server-banners/x.svg",
            "/uploads/server-banners/x y.png",
            "/uploads/server-banners/.png",
            "javascript:alert(1)",
            "",
        ] {
            assert!(!valid_image_ref(bad), "{bad}");
            assert!(parse_server_look(&json!({ "sidebar_bg": { "kind": "image", "image": bad } })).is_err(), "{bad}");
        }
        assert!(valid_image_ref("/uploads/server-banners/3f2a9c1e-1111-4a4a-9b9b-0123456789ab.webp"));
        assert!(valid_image_ref("/uploads/server-banners/a_3f2a9c1e.gif"));
    }

    #[test]
    fn background_normalized_per_kind() {
        let v = parse_server_look(&json!({
            "sidebar_bg": { "kind": "color", "color": 0x112233, "color2": 0x445566, "pattern": "dots", "image": "/uploads/server-banners/x.png", "blur": 10 }
        })).unwrap().unwrap();
        assert_eq!(v["sidebar_bg"], json!({ "kind": "color", "color": 0x112233, "angle": 135, "opacity": 100, "blur": 0 }));
        assert!(parse_server_look(&json!({ "sidebar_bg": { "kind": "gradient", "color": 1 } })).is_err());
        assert!(parse_server_look(&json!({ "sidebar_bg": { "kind": "color" } })).is_err());
        let p = parse_server_look(&json!({ "message_bg": { "kind": "pattern", "pattern": "grid", "color": 0xffffff, "opacity": 20 } })).unwrap().unwrap();
        assert_eq!(p["message_bg"]["pattern"], "grid");
        let i = parse_server_look(&json!({ "message_bg": { "kind": "image", "image": "/uploads/server-banners/x.png", "color": 5 } })).unwrap().unwrap();
        assert!(i["message_bg"].get("color").is_none());
    }

    #[test]
    fn full_look_round_trips() {
        let input = json!({
            "banner": { "focus_x": 20, "focus_y": 80, "height": "full", "overlay": "vignette", "overlay_strength": 40 },
            "accent": 0x5865f2, "accent2": 0xeb459e,
            "name": { "colors": [0xffd166, 0xef476f], "angle": 45, "font": "serif", "effect": "glow" },
            "icon_shape": "hexagon", "icon_ring": "glow", "icon_ring_color": 0x00ffcc,
            "welcome": "card", "unread_color": 0xfaa61a, "role_display": "badge", "enforce": true,
        });
        let v = parse_server_look(&input).unwrap().unwrap();
        assert_eq!(v, input);
        // Re-validation idempotente.
        assert_eq!(parse_server_look(&v).unwrap().unwrap(), v);
        let look: ServerLook = serde_json::from_value(v).unwrap();
        assert!(look.sidebar_bg.is_none() && look.message_bg.is_none());
    }

    #[test]
    fn ring_color_dropped_without_ring() {
        let v = parse_server_look(&json!({ "icon_shape": "square", "icon_ring_color": 0xff0000 })).unwrap().unwrap();
        assert_eq!(v, json!({ "icon_shape": "square" }));
    }

    #[test]
    fn enforce_alone_is_kept_off() {
        // « Imposer » sans aucune personnalisation : rien à imposer.
        assert_eq!(parse_server_look(&json!({ "enforce": true })), Ok(None));
    }
}
