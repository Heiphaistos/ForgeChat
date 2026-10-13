//! Mise en page de la carte / popout de profil (`users.profile_card`). Seulement des
//! identifiants en liste blanche, des nombres bornés et des booléens : le client en tire
//! des classes et des variables CSS numériques, jamais une chaîne de l'utilisateur.
//! Les couleurs restent `profile_color_primary` / `profile_color_accent`.
//! Valeurs par défaut non stockées ; tout par défaut → NULL.

use serde::{Deserialize, Serialize};

pub const CARD_LAYOUTS: &[&str] = &["classic", "centered", "compact", "wide"];
pub const CARD_STYLES: &[&str] = &["solid", "gradient", "glass", "outline", "neon"];
pub const CARD_PATTERNS: &[&str] = &[
    "none", "dots", "grid", "lines", "diagonal", "checker", "waves",
];
pub const BANNER_FX: &[&str] = &["none", "blur", "dim", "fade", "duotone"];
pub const NAME_ALIGNS: &[&str] = &["left", "center"];
pub const CARD_RADIUS_MAX: u8 = 24;
/// Taille maximale du JSON stocké (même borne que la contrainte de la migration 136).
pub const PROFILE_CARD_MAX_BYTES: usize = 512;

const BANNER_Y_MAX: u8 = 100;
const BANNER_Y_DEFAULT: u8 = 50;
const RADIUS_DEFAULT: u8 = 12;
const ANGLE_MAX: u16 = 360;
const ANGLE_DEFAULT: u16 = 180;

fn classic() -> String {
    "classic".into()
}
fn is_classic(v: &String) -> bool {
    v == "classic"
}
fn solid() -> String {
    "solid".into()
}
fn is_solid(v: &String) -> bool {
    v == "solid"
}
fn none() -> String {
    "none".into()
}
fn is_none(v: &String) -> bool {
    v == "none"
}
fn left() -> String {
    "left".into()
}
fn is_left(v: &String) -> bool {
    v == "left"
}
fn banner_y() -> u8 {
    BANNER_Y_DEFAULT
}
fn is_banner_y(v: &u8) -> bool {
    *v == BANNER_Y_DEFAULT
}
fn radius() -> u8 {
    RADIUS_DEFAULT
}
fn is_radius(v: &u8) -> bool {
    *v == RADIUS_DEFAULT
}
fn angle() -> u16 {
    ANGLE_DEFAULT
}
fn is_angle(v: &u16) -> bool {
    *v == ANGLE_DEFAULT
}
fn yes() -> bool {
    true
}
fn is_true(v: &bool) -> bool {
    *v
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProfileCard {
    /// Disposition (CARD_LAYOUTS).
    #[serde(default = "classic", skip_serializing_if = "is_classic")]
    pub layout: String,
    /// Habillage de la carte (CARD_STYLES).
    #[serde(default = "solid", skip_serializing_if = "is_solid")]
    pub card: String,
    /// Motif de fond (CARD_PATTERNS).
    #[serde(default = "none", skip_serializing_if = "is_none")]
    pub pattern: String,
    /// Point focal vertical de la bannière en % (0-100).
    #[serde(default = "banner_y", skip_serializing_if = "is_banner_y")]
    pub banner_y: u8,
    /// Effet sur la bannière (BANNER_FX).
    #[serde(default = "none", skip_serializing_if = "is_none")]
    pub banner_fx: String,
    /// Arrondi des coins en px (0-CARD_RADIUS_MAX).
    #[serde(default = "radius", skip_serializing_if = "is_radius")]
    pub radius: u8,
    /// Angle du dégradé de la carte en degrés (0-360).
    #[serde(default = "angle", skip_serializing_if = "is_angle")]
    pub angle: u16,
    #[serde(default = "yes", skip_serializing_if = "is_true")]
    pub show_badges: bool,
    #[serde(default = "yes", skip_serializing_if = "is_true")]
    pub show_links: bool,
    /// Alignement du nom (NAME_ALIGNS).
    #[serde(default = "left", skip_serializing_if = "is_left")]
    pub name_align: String,
}

/// `null`, `{}` ou tout par défaut → None ; sinon la carte normalisée à stocker.
/// Refuse tout champ inconnu, toute valeur hors bornes, non entière ou d'un autre type.
pub fn parse_profile_card(
    v: &serde_json::Value,
) -> Result<Option<serde_json::Value>, &'static str> {
    if v.is_null() {
        return Ok(None);
    }
    let c: ProfileCard =
        serde_json::from_value(v.clone()).map_err(|_| "Carte de profil invalide")?;
    let lists = [
        (
            &c.layout,
            CARD_LAYOUTS,
            "Carte de profil : disposition inconnue",
        ),
        (&c.card, CARD_STYLES, "Carte de profil : habillage inconnu"),
        (&c.pattern, CARD_PATTERNS, "Carte de profil : motif inconnu"),
        (
            &c.banner_fx,
            BANNER_FX,
            "Carte de profil : effet de bannière inconnu",
        ),
        (
            &c.name_align,
            NAME_ALIGNS,
            "Carte de profil : alignement left ou center",
        ),
    ];
    for (v, list, err) in lists {
        if !list.contains(&v.as_str()) {
            return Err(err);
        }
    }
    if c.banner_y > BANNER_Y_MAX {
        return Err("Carte de profil : position de la bannière 0-100 %");
    }
    if c.radius > CARD_RADIUS_MAX {
        return Err("Carte de profil : arrondi 0-24 px");
    }
    if c.angle > ANGLE_MAX {
        return Err("Carte de profil : angle 0-360°");
    }
    let out = serde_json::to_value(c).map_err(|_| "Carte de profil invalide")?;
    if out.as_object().is_some_and(|o| o.is_empty()) {
        return Ok(None);
    }
    if out.to_string().len() > PROFILE_CARD_MAX_BYTES {
        return Err("Carte de profil trop longue");
    }
    Ok(Some(out))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn tout_par_defaut_donne_null() {
        assert_eq!(parse_profile_card(&json!(null)).unwrap(), None);
        assert_eq!(parse_profile_card(&json!({})).unwrap(), None);
        let defaults = json!({
            "layout": "classic", "card": "solid", "pattern": "none", "banner_y": 50, "banner_fx": "none",
            "radius": 12, "angle": 180, "show_badges": true, "show_links": true, "name_align": "left",
        });
        assert_eq!(parse_profile_card(&defaults).unwrap(), None);
    }

    #[test]
    fn seuls_les_champs_modifies_sont_gardes() {
        let c = parse_profile_card(&json!({ "layout": "wide", "radius": 12, "show_links": false }))
            .unwrap()
            .unwrap();
        assert_eq!(c, json!({ "layout": "wide", "show_links": false }));
        let full = parse_profile_card(&json!({
            "layout": "centered", "card": "neon", "pattern": "waves", "banner_y": 0, "banner_fx": "duotone",
            "radius": 24, "angle": 360, "show_badges": false, "show_links": false, "name_align": "center",
        }))
        .unwrap()
        .unwrap();
        assert_eq!(full["banner_y"], 0);
        assert_eq!(full["show_badges"], false);
        assert!(full.to_string().len() <= PROFILE_CARD_MAX_BYTES);
        for (k, list) in [
            ("layout", CARD_LAYOUTS),
            ("card", CARD_STYLES),
            ("pattern", CARD_PATTERNS),
            ("banner_fx", BANNER_FX),
            ("name_align", NAME_ALIGNS),
        ] {
            for id in list {
                assert!(parse_profile_card(&json!({ k: id })).is_ok(), "{k}={id}");
            }
        }
    }

    #[test]
    fn bornes_et_types_refuses() {
        for bad in [
            json!({ "layout": "grid" }),
            json!({ "layout": "" }),
            json!({ "card": "url(x)" }),
            json!({ "pattern": "zigzag" }),
            json!({ "banner_fx": "sepia" }),
            json!({ "name_align": "right" }),
            json!({ "banner_y": 101 }),
            json!({ "banner_y": -1 }),
            json!({ "banner_y": 50.5 }),
            json!({ "radius": 25 }),
            json!({ "angle": 361 }),
            json!({ "angle": "90" }),
            json!({ "show_badges": "false" }),
            json!({ "show_links": 0 }),
            json!({ "show_badges": null }),
            json!({ "css": "color:red" }),
            json!({ "layout": "wide", "extra": 1 }),
            json!("classic"),
            json!([1]),
            json!(42),
        ] {
            assert!(parse_profile_card(&bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn identifiants_surs_et_uniques() {
        for list in [
            CARD_LAYOUTS,
            CARD_STYLES,
            CARD_PATTERNS,
            BANNER_FX,
            NAME_ALIGNS,
        ] {
            let mut seen = std::collections::HashSet::new();
            for id in list {
                assert!(seen.insert(*id), "doublon {id}");
                assert!(id.bytes().all(|b| b.is_ascii_lowercase()), "{id}");
            }
        }
    }
}
