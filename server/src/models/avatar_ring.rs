//! Anneau d'avatar v2 : global (`users.avatar_ring`) et par serveur
//! (`server_members.server_avatar_ring`). Anneau affiché = celui du serveur s'il existe,
//! sinon l'anneau global. Rendu web : components/ui/AvatarRing.tsx ; mobile :
//! components/AvatarRing.tsx (mêmes listes, vérifiées par les tests de parité).
//! Tout anneau v1 stocké (≤ 3 couleurs, épaisseur ≤ 8, 14 premiers styles) reste valide
//! et ressort à l'identique : `width` et `style` restent toujours écrits (comme en v1),
//! les nouveaux réglages ne le sont que s'ils diffèrent de leur valeur par défaut.

use std::ops::RangeInclusive;

use serde::{Deserialize, Serialize};

use super::profile_style::{
    cw, hundred, is_cw, is_hundred, is_zero16, BRIGHTNESS_RANGE, COLOR_MAX, DIRECTIONS, GLOW_RANGE,
    OPACITY_RANGE, SPEED_RANGE,
};

/// Styles d'anneau (ordre exact partagé avec le web et le mobile ; les 14 premiers = v1).
pub const RING_STYLES: &[&str] = &[
    "solid",
    "dashed",
    "dotted",
    "double",
    "glow",
    "spin",
    "pulse",
    "gradient_spin",
    "rainbow",
    "dashed_spin",
    "neon_pulse",
    "comet",
    "segmented",
    "breathe",
    "orbit",
    "double_orbit",
    "aurora",
    "fire",
    "electric",
    "wave",
    "heartbeat",
    "sparkle",
    "radar",
    "prism",
    "chase",
    "ripple",
    "glitch",
    "twin_comet",
    "stripes",
    "flicker",
    "halo",
    "sunburst",
    "vortex",
    "matrix",
];
/// Forme du dégradé multi-couleurs.
pub const RING_FILLS: &[&str] = &["conic", "linear", "radial"];
/// Forme de l'anneau.
pub const RING_SHAPES: &[&str] = &["circle", "rounded", "squircle"];
pub const RING_COLORS_MAX: usize = 8;
pub const RING_WIDTH_MAX: u8 = 12;
/// Espace entre l'avatar et l'anneau (px) ; absent = automatique.
pub const RING_GAP_MAX: u8 = 8;
/// Nombre de segments (styles segmented, dashed_spin, stripes, chase, matrix).
pub const RING_SEGMENTS_RANGE: RangeInclusive<u8> = 2..=24;
/// Amplitude de l'animation en % (pulsation, scintillement…).
pub const INTENSITY_RANGE: RangeInclusive<u16> = 25..=200;
/// Taille maximale du JSON stocké (mêmes bornes que les contraintes de la migration 136).
pub const RING_MAX_BYTES: usize = 512;

const ANGLE_MAX: u16 = 360;
const SEGMENTS_DEFAULT: u8 = 12;

fn default_ring_width() -> u8 {
    3
}
fn conic() -> String {
    "conic".into()
}
fn is_conic(v: &String) -> bool {
    v == "conic"
}
fn circle() -> String {
    "circle".into()
}
fn is_circle(v: &String) -> bool {
    v == "circle"
}
fn default_segments() -> u8 {
    SEGMENTS_DEFAULT
}
fn is_default_segments(v: &u8) -> bool {
    *v == SEGMENTS_DEFAULT
}

/// Anneau autour de l'avatar. Seulement des couleurs 0xRRGGBB, des nombres bornés et des
/// identifiants en liste blanche : le client n'en tire jamais de CSS brut.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AvatarRing {
    /// 1 couleur = unie, 2 à RING_COLORS_MAX = dégradé ; aucune = pas d'anneau.
    #[serde(default)]
    pub colors: Vec<u32>,
    #[serde(default = "default_ring_width")]
    pub width: u8,
    #[serde(default)]
    pub style: String,
    /// Forme du dégradé (RING_FILLS).
    #[serde(default = "conic", skip_serializing_if = "is_conic")]
    pub fill: String,
    /// Rotation de départ du dégradé en degrés (0-360).
    #[serde(default, skip_serializing_if = "is_zero16")]
    pub angle: u16,
    /// Forme de l'anneau (RING_SHAPES).
    #[serde(default = "circle", skip_serializing_if = "is_circle")]
    pub shape: String,
    /// Espace avatar-anneau en px ; absent = automatique.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gap: Option<u8>,
    /// Nombre de segments (RING_SEGMENTS_RANGE).
    #[serde(
        default = "default_segments",
        skip_serializing_if = "is_default_segments"
    )]
    pub segments: u8,
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
    /// Opacité en % (OPACITY_RANGE).
    #[serde(default = "hundred", skip_serializing_if = "is_hundred")]
    pub opacity: u16,
    /// Amplitude de l'animation en % (INTENSITY_RANGE).
    #[serde(default = "hundred", skip_serializing_if = "is_hundred")]
    pub intensity: u16,
}

/// `null`, `{}` ou aucune couleur → None (pas d'anneau) ; sinon l'anneau normalisé.
/// Refuse tout champ inconnu, toute valeur hors bornes, non entière ou d'un autre type.
pub fn parse_avatar_ring(v: &serde_json::Value) -> Result<Option<serde_json::Value>, &'static str> {
    if v.is_null() {
        return Ok(None);
    }
    let mut r: AvatarRing =
        serde_json::from_value(v.clone()).map_err(|_| "Anneau d'avatar invalide")?;
    if r.colors.len() > RING_COLORS_MAX || r.colors.iter().any(|&c| c > COLOR_MAX) {
        return Err("Anneau d'avatar : 8 couleurs 0xRRGGBB au plus");
    }
    if r.width == 0 || r.width > RING_WIDTH_MAX {
        return Err("Anneau d'avatar : épaisseur 1-12");
    }
    if r.style.is_empty() {
        r.style = "solid".into();
    }
    if !RING_STYLES.contains(&r.style.as_str()) {
        return Err("Anneau d'avatar : style inconnu");
    }
    if !RING_FILLS.contains(&r.fill.as_str()) {
        return Err("Anneau d'avatar : dégradé conic, linear ou radial");
    }
    if !RING_SHAPES.contains(&r.shape.as_str()) {
        return Err("Anneau d'avatar : forme circle, rounded ou squircle");
    }
    if r.angle > ANGLE_MAX {
        return Err("Anneau d'avatar : angle 0-360°");
    }
    if r.gap.is_some_and(|g| g > RING_GAP_MAX) {
        return Err("Anneau d'avatar : espacement 0-8 px");
    }
    if !RING_SEGMENTS_RANGE.contains(&r.segments) {
        return Err("Anneau d'avatar : segments 2-24");
    }
    if !DIRECTIONS.contains(&r.direction.as_str()) {
        return Err("Anneau d'avatar : sens cw ou ccw");
    }
    let bounds = [
        (r.speed, &SPEED_RANGE, "Anneau d'avatar : vitesse 25-400 %"),
        (
            r.brightness,
            &BRIGHTNESS_RANGE,
            "Anneau d'avatar : luminosité 50-200 %",
        ),
        (r.glow, &GLOW_RANGE, "Anneau d'avatar : lueur 0-300 %"),
        (
            r.opacity,
            &OPACITY_RANGE,
            "Anneau d'avatar : opacité 20-100 %",
        ),
        (
            r.intensity,
            &INTENSITY_RANGE,
            "Anneau d'avatar : intensité 25-200 %",
        ),
    ];
    for (v, range, err) in bounds {
        if !range.contains(&v) {
            return Err(err);
        }
    }
    if r.colors.is_empty() {
        return Ok(None);
    }
    let out = serde_json::to_value(r).map_err(|_| "Anneau d'avatar invalide")?;
    if out.to_string().len() > RING_MAX_BYTES {
        return Err("Anneau d'avatar trop long");
    }
    Ok(Some(out))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ok(v: serde_json::Value) -> serde_json::Value {
        parse_avatar_ring(&v).unwrap().unwrap()
    }

    #[test]
    fn anneau_d_avatar() {
        assert_eq!(parse_avatar_ring(&json!(null)).unwrap(), None);
        assert_eq!(parse_avatar_ring(&json!({})).unwrap(), None);
        assert_eq!(parse_avatar_ring(&json!({ "colors": [] })).unwrap(), None);
        let r = ok(json!({ "colors": [0xff00ff, 0x00ffff], "width": 4 }));
        assert_eq!(r["style"], "solid");
        assert_eq!(ok(json!({ "colors": [1], "style": "spin" }))["width"], 3);
        assert!(parse_avatar_ring(&json!({ "colors": [0x1000000] })).is_err());
        assert!(
            parse_avatar_ring(&json!({ "colors": [1], "style": "solid;background:url(x)" }))
                .is_err()
        );
        assert!(parse_avatar_ring(&json!({ "colors": [1], "css": "x" })).is_err());
        assert!(parse_avatar_ring(&json!("solid")).is_err());
        assert!(parse_avatar_ring(&json!([1, 2])).is_err());
    }

    #[test]
    fn anneaux_v1_inchanges() {
        // Formes réellement stockées en v1 : relues puis réécrites à l'identique.
        for v1 in [
            json!({ "colors": [16711680], "width": 3, "style": "solid" }),
            json!({ "colors": [1, 2, 3], "width": 8, "style": "breathe" }),
            json!({ "colors": [0xffffff, 0xffffff, 0xffffff], "width": 8, "style": "gradient_spin", "speed": 400, "direction": "ccw", "brightness": 200, "glow": 300 }),
            json!({ "colors": [5], "width": 1, "style": "comet", "glow": 0 }),
        ] {
            assert_eq!(ok(v1.clone()), v1);
        }
        for s in &RING_STYLES[..14] {
            let v1 = json!({ "colors": [1], "width": 3, "style": s });
            assert_eq!(ok(v1.clone()), v1);
        }
    }

    #[test]
    fn anneau_v2_complet() {
        for s in RING_STYLES {
            assert_eq!(ok(json!({ "colors": [1], "style": s }))["style"], *s);
        }
        for f in RING_FILLS {
            assert!(parse_avatar_ring(&json!({ "colors": [1], "fill": f })).is_ok());
        }
        for s in RING_SHAPES {
            assert!(parse_avatar_ring(&json!({ "colors": [1], "shape": s })).is_ok());
        }
        let r = ok(json!({
            "colors": [1, 2, 3, 4, 5, 6, 7, 8], "width": 12, "style": "twin_comet", "fill": "radial",
            "angle": 360, "shape": "squircle", "gap": 0, "segments": 24, "speed": 25, "direction": "ccw",
            "brightness": 50, "glow": 300, "opacity": 20, "intensity": 200,
        }));
        assert_eq!(r["gap"], 0);
        assert_eq!(r["segments"], 24);
        assert_eq!(r["opacity"], 20);
        assert_eq!(r["fill"], "radial");
        assert_eq!(
            ok(json!({ "colors": [1], "gap": 8, "segments": 2, "intensity": 25 }))["segments"],
            2
        );
    }

    #[test]
    fn valeurs_par_defaut_non_ecrites() {
        let d = ok(json!({
            "colors": [1], "fill": "conic", "angle": 0, "shape": "circle", "segments": 12,
            "speed": 100, "direction": "cw", "brightness": 100, "glow": 100, "opacity": 100, "intensity": 100,
        }));
        assert_eq!(d, json!({ "colors": [1], "width": 3, "style": "solid" }));
    }

    #[test]
    fn bornes_refusees() {
        let nine: Vec<u32> = (0..9).collect();
        for bad in [
            json!({ "colors": nine }),
            json!({ "colors": [1], "width": 0 }),
            json!({ "colors": [1], "width": 13 }),
            json!({ "colors": [1], "style": "gradient-spin" }),
            json!({ "colors": [1], "style": "Solid" }),
            json!({ "colors": [1], "fill": "" }),
            json!({ "colors": [1], "fill": "repeating-conic" }),
            json!({ "colors": [1], "shape": "square" }),
            json!({ "colors": [1], "shape": "" }),
            json!({ "colors": [1], "gap": 9 }),
            json!({ "colors": [1], "gap": -1 }),
            json!({ "colors": [1], "segments": 1 }),
            json!({ "colors": [1], "segments": 25 }),
            json!({ "colors": [1], "intensity": 24 }),
            json!({ "colors": [1], "intensity": 201 }),
            json!({ "colors": [1], "opacity": 19 }),
            json!({ "colors": [1], "opacity": 101 }),
            json!({ "colors": [1], "angle": 361 }),
            json!({ "colors": [1], "angle": 1.5 }),
            json!({ "colors": [1], "speed": 24 }),
            json!({ "colors": [1], "speed": 401 }),
            json!({ "colors": [1], "speed": "fast" }),
            json!({ "colors": [1], "direction": "left" }),
            json!({ "colors": [1], "direction": "" }),
            json!({ "colors": [1], "brightness": 49 }),
            json!({ "colors": [1], "brightness": 201 }),
            json!({ "colors": [1], "glow": 301 }),
            json!({ "colors": [1], "glow": -1 }),
            json!({ "colors": [1], "shadow": "0 0 4px red" }),
        ] {
            assert!(parse_avatar_ring(&bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn taille_max() {
        // Pire cas valide : tient sous RING_MAX_BYTES (contrainte en base, migration 136).
        let longest = |l: &[&str]| l.iter().max_by_key(|s| s.len()).unwrap().to_string();
        let max = ok(json!({
            "colors": vec![0xffffff; RING_COLORS_MAX], "width": RING_WIDTH_MAX, "style": longest(RING_STYLES),
            "fill": longest(RING_FILLS), "angle": 359, "shape": longest(RING_SHAPES), "gap": RING_GAP_MAX,
            "segments": 23, "speed": 400, "direction": "ccw", "brightness": 200, "glow": 300,
            "opacity": 99, "intensity": 199,
        }));
        assert!(
            max.to_string().len() <= RING_MAX_BYTES,
            "{}",
            max.to_string().len()
        );
        // Entrée de plus de 512 octets (espaces, zéros de tête…) : refusée par la désérialisation
        // ou ramenée sous la borne après normalisation ; jamais stockée telle quelle.
        let padded = format!("{{\"colors\":[1],{}\"width\":3}}", " ".repeat(600));
        let v: serde_json::Value = serde_json::from_str(&padded).unwrap();
        assert!(ok(v).to_string().len() <= RING_MAX_BYTES);
        let big = json!({ "colors": [1], "style": "x".repeat(600) });
        assert!(big.to_string().len() > RING_MAX_BYTES);
        assert!(parse_avatar_ring(&big).is_err());
    }

    #[test]
    fn identifiants_surs_et_uniques() {
        for list in [RING_STYLES, RING_FILLS, RING_SHAPES] {
            let mut seen = std::collections::HashSet::new();
            for id in list {
                assert!(seen.insert(*id), "doublon {id}");
                assert!(
                    id.bytes().all(|b| b.is_ascii_lowercase() || b == b'_'),
                    "{id}"
                );
            }
        }
        assert_eq!(RING_STYLES.len(), 34);
    }
}
