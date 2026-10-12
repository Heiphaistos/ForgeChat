//! En-têtes de sécurité posés par le serveur lui-même (audit 2026-10-12, durcissement web), en plus
//! de ceux de nginx : l'API ne dépend pas d'une configuration externe pour être protégée.
use axum::{
    extract::Request,
    http::{header, HeaderValue},
    middleware::Next,
    response::Response,
};

/// Toutes les réponses : pas de reniflage de type, pas de Referer, jamais encadrées.
/// API (`/api`, `/ws`) en plus : jamais mises en cache (jetons, messages, clés), rendues
/// inertes si un navigateur les ouvre comme une page, lisibles seulement par notre origine.
pub async fn apply(req: Request, next: Next) -> Response {
    let api = req.uri().path().starts_with("/api/") || req.uri().path() == "/ws";
    let mut res = next.run(req).await;
    let h = res.headers_mut();
    let mut set = |name: header::HeaderName, value: &'static str| {
        if !h.contains_key(&name) {
            h.insert(name, HeaderValue::from_static(value));
        }
    };
    set(header::X_CONTENT_TYPE_OPTIONS, "nosniff");
    set(header::REFERRER_POLICY, "no-referrer");
    set(header::X_FRAME_OPTIONS, "DENY");
    if api {
        set(header::CACHE_CONTROL, "no-store");
        set(header::CONTENT_SECURITY_POLICY, "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
        set(header::HeaderName::from_static("cross-origin-resource-policy"), "same-origin");
        set(header::HeaderName::from_static("x-permitted-cross-domain-policies"), "none");
    }
    res
}

#[cfg(test)]
mod tests {
    use axum::{body::Body, http::Request, routing::get, Router};
    use tower::Service;

    #[tokio::test]
    async fn api_and_static_headers() {
        let app = Router::new()
            .route("/api/x", get(|| async { "{}" }))
            .route("/uploads/a.png", get(|| async { "png" }))
            .layer(axum::middleware::from_fn(super::apply));
        let api = app.clone().call(Request::get("/api/x").body(Body::empty()).unwrap()).await.unwrap();
        let h = api.headers();
        assert_eq!(h["cache-control"], "no-store");
        assert_eq!(h["x-content-type-options"], "nosniff");
        assert_eq!(h["cross-origin-resource-policy"], "same-origin");
        assert!(h["content-security-policy"].to_str().unwrap().contains("default-src 'none'"));
        let file = app.clone().call(Request::get("/uploads/a.png").body(Body::empty()).unwrap()).await.unwrap();
        let h = file.headers();
        assert_eq!(h["x-frame-options"], "DENY");
        assert!(h.get("cross-origin-resource-policy").is_none(), "avatars lus par l'appli de bureau (autre origine)");
        assert!(h.get("cache-control").is_none());
    }
}
