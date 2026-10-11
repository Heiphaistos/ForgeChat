//! Modèles de serveur intégrés (choisis à la création d'un serveur).
//!
//! Même format que les modèles enregistrés (`server_templates.template_data`) :
//! catégories (`staff_only` = réservée aux administrateurs), salons rattachés par
//! `category_id`, rôles. Noms en français (comme le salon « général » par défaut) ;
//! le nom et la description du modèle sont traduits par les applis (`tpl.<id>`).

use serde_json::{json, Value};

use crate::models::role::Permissions as P;

/// Identifiants publics, dans l'ordre d'affichage.
pub const IDS: &[&str] = &["gaming", "friends", "community", "study", "creator", "jotunheim"];

const MOD: i64 = P::MANAGE_MESSAGES | P::KICK_MEMBERS | P::BAN_TEMP | P::MUTE_MEMBERS | P::MANAGE_NICKNAMES
    | P::DEAFEN_MEMBERS | P::MOVE_MEMBERS | P::MENTION_EVERYONE;

/// Catégories puis salons : `(catégorie, réservée au staff, [(salon, type)])`.
type Layout<'a> = &'a [(&'a str, bool, &'a [(&'a str, &'a str)])];

fn build(name: &str, layout: Layout, roles: &[(&str, i64, i32)]) -> Value {
    let mut categories = Vec::new();
    let mut channels = Vec::new();
    for (ci, (cat, staff, chans)) in layout.iter().enumerate() {
        let cat_id = format!("c{ci}");
        categories.push(json!({ "id": cat_id, "name": cat, "position": ci, "staff_only": staff }));
        for (pi, (ch, ty)) in chans.iter().enumerate() {
            channels.push(json!({ "name": ch, "type": ty, "position": pi, "category_id": cat_id }));
        }
    }
    let roles: Vec<Value> = roles
        .iter()
        .enumerate()
        .map(|(i, (n, perms, color))| json!({ "name": n, "permissions": perms, "position": roles.len() - i, "color": color }))
        .collect();
    json!({ "name": name, "categories": categories, "channels": channels, "roles": roles })
}

/// Données du modèle intégré `id`, ou `None` s'il n'existe pas.
pub fn get(id: &str) -> Option<Value> {
    Some(match id {
        "gaming" => build(
            "Gaming",
            &[
                ("Infos", false, &[("annonces", "announcement"), ("règles", "text")]),
                ("Discussion", false, &[("général", "text"), ("recherche-équipe", "text"), ("clips", "media")]),
                ("Vocal", false, &[("Partie 1", "voice"), ("Partie 2", "voice"), ("AFK", "voice")]),
                ("Staff", true, &[("modération", "text")]),
            ],
            &[("Modérateur", MOD, 0x3BA55C), ("Joueur", 0, 0x5865F2)],
        ),
        "friends" => build(
            "Amis",
            &[
                ("Discussion", false, &[("général", "text"), ("photos", "media"), ("bons-plans", "text")]),
                ("Vocal", false, &[("Salon", "voice"), ("Soirée jeux", "voice")]),
            ],
            &[],
        ),
        "community" => build(
            "Communauté",
            &[
                ("Bienvenue", false, &[("accueil", "text"), ("règles", "text"), ("annonces", "announcement")]),
                ("Communauté", false, &[("général", "text"), ("présentations", "text"), ("aide", "forum"), ("suggestions", "forum")]),
                ("Vocal", false, &[("Vocal général", "voice"), ("Événements", "stage")]),
                ("Staff", true, &[("modération", "text"), ("journal", "text")]),
            ],
            &[("Modérateur", MOD, 0x3BA55C), ("Membre actif", 0, 0xFAA61A)],
        ),
        "study" => build(
            "Étude",
            &[
                ("Infos", false, &[("annonces", "announcement"), ("ressources", "text")]),
                ("Travail", false, &[("questions", "forum"), ("devoirs", "text"), ("projets", "text")]),
                ("Vocal", false, &[("Étude silencieuse", "voice"), ("Groupe de travail", "voice")]),
            ],
            &[("Tuteur", P::MANAGE_MESSAGES | P::MENTION_EVERYONE, 0x1ABC9C)],
        ),
        "creator" => build(
            "Créateur",
            &[
                ("Infos", false, &[("annonces", "announcement"), ("nouveautés", "text")]),
                ("Communauté", false, &[("général", "text"), ("créations", "media"), ("suggestions", "forum")]),
                ("Vocal", false, &[("Live", "stage"), ("Discussion", "voice")]),
                ("Coulisses", true, &[("planning", "text"), ("idées", "text")]),
            ],
            &[("Modérateur", MOD, 0x3BA55C), ("Abonné", 0, 0xE91E63)],
        ),
        // Serveur du propriétaire de la plateforme : UNIQUEMENT ses catégories, aucun
        // salon (demande explicite), ADMINISTRATEUR réservée aux administrateurs.
        "jotunheim" => build(
            "Jötunheim",
            &[
                ("・・・INFORMATION・・・", false, &[]),
                ("・・・Aide・・・", false, &[]),
                ("・・・CHAT TEXTUEL・・・", false, &[]),
                ("・・・CHAT VOCAL・・・", false, &[]),
                ("・・・ADMINISTRATEUR・・・", true, &[]),
                ("・・・INFORMATIQUE・・・", false, &[]),
                ("・・・ID / SITE WEB・・・", false, &[]),
                ("・・・STREAMING・・・", false, &[]),
                ("・・・JEUX VIDEO・・・", false, &[]),
                ("・・・ACTUALITE・・・", false, &[]),
                ("・・・WEEK-END・・・", false, &[]),
                ("・・・VIDEO・・・", false, &[]),
            ],
            &[],
        ),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_builtin_is_valid() {
        for id in IDS {
            let t = get(id).expect(id);
            crate::handlers::templates::parse_template(&t).unwrap_or_else(|e| panic!("{id}: {e}"));
        }
        assert!(get("inconnu").is_none());
    }

    #[test]
    fn jotunheim_is_categories_only_in_order() {
        let t = crate::handlers::templates::parse_template(&get("jotunheim").unwrap()).unwrap();
        assert!(t.channels.is_empty() && t.roles.is_empty());
        let names: Vec<&str> = t.categories.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names.len(), 12);
        assert_eq!(names[0], "・・・INFORMATION・・・");
        assert_eq!(names[11], "・・・VIDEO・・・");
        let staff: Vec<&str> = t.categories.iter().filter(|c| c.staff_only).map(|c| c.name.as_str()).collect();
        assert_eq!(staff, ["・・・ADMINISTRATEUR・・・"]);
        assert!(names.iter().all(|n| n.chars().all(|c| !matches!(c as u32, 0x1F300..=0x1FAFF))), "aucun emoji");
    }
}
