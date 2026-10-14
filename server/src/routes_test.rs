//! Construit la table de routes complète comme `main`, sans Postgres ni Redis :
//! axum 0.7 panique à l'insertion d'une route en conflit (même chemin et même
//! méthode, ou paramètres de nom différent au même segment), donc un simple
//! assemblage suffit à attraper ce qui ferait planter le serveur au démarrage.
//! Seules les couches portant `AppState` (auth, compteur d'erreurs) manquent :
//! elles n'ajoutent aucune route.

#[test]
fn full_router_builds_without_route_conflict() {
    let _ = crate::app_routes(crate::protected_route_table(), "uploads");
}

/// Garde-fou du test ci-dessus : un doublon dans la table protégée panique bien
/// à l'assemblage (sinon le test passerait sans rien vérifier).
#[test]
#[should_panic]
fn duplicate_route_is_caught() {
    let dup = crate::protected_route_table()
        .route("/friends/blocked", axum::routing::get(|| async { "" }));
    let _ = crate::app_routes(dup, "uploads");
}
