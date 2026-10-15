//! Tutoriels vidéo du site tuto.heiphaistos.org, relayés par le serveur.
//!
//! Le catalogue complet (~1050 entrées) est lu par pagination sur l'API publique du site, gardé
//! en mémoire ~10 min (périmé servi si le site est injoignable) ; catégories, groupes, recherche
//! et pagination sont calculés ici sur ce cache. Rien n'est écrit en base. Hôte fixe : le client
//! ne fournit jamais d'URL, seulement des paramètres de filtre bornés.

use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};

use crate::{
    error::{AppError, Result},
    middleware::auth::Claims,
    state::AppState,
};

const HOST: &str = "tuto.heiphaistos.org";
const API_PAGE: &str = "https://tuto.heiphaistos.org/api/tutorials";
const API_PER_PAGE: u32 = 50; // maximum accepté par le site
const MAX_API_PAGES: u32 = 60; // garde-fou : 3000 tutoriels
const MAX_PAGE_BYTES: usize = 3 * 1024 * 1024;
const CACHE_TTL: Duration = Duration::from_secs(600);
const RATE_PER_MINUTE: i64 = 120;
const MAX_PER_PAGE: usize = 60;
const DEFAULT_PER_PAGE: usize = 24;
const MAX_QUERY_CHARS: usize = 100;

// ─── Données du site ─────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct RawPage {
    items: Vec<Raw>,
    #[serde(default)]
    total: usize,
}

#[derive(Deserialize)]
struct RawCat {
    slug: String,
    name: String,
    icon: Option<String>,
}

#[derive(Deserialize)]
struct RawTag {
    name: String,
}

#[derive(Deserialize)]
struct RawTagLink {
    tag: RawTag,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Raw {
    title: String,
    slug: String,
    description: Option<String>,
    content: Option<String>,
    video_url: Option<String>,
    #[serde(default)]
    published: bool,
    created_at: String,
    category: RawCat,
    #[serde(default)]
    tags: Vec<RawTagLink>,
}

// ─── Modèle servi ────────────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
pub struct Cat {
    pub slug: String,
    pub name: String,
    pub icon: String,
}

#[derive(Clone, Serialize)]
pub struct Item {
    pub slug: String,
    pub title: String,
    pub description: String,
    pub category: Cat,
    pub group: String,
    pub tags: Vec<String>,
    pub video_url: String,
    /// Miniature `<slug>.thumb.jpg` posée à côté du film sur le site ; absente (null) pour un film sans `.mp4`.
    pub thumbnail_url: Option<String>,
    pub created_at: String,
    #[serde(skip)]
    content_html: String,
    #[serde(skip)]
    haystack: String,
}

pub struct Snapshot {
    pub items: Vec<Item>,
    pub catalog: Value,
}

// ─── Regroupement « par distribution / version » ─────────────────────────────

/// (clé, libellé, mots-clés cherchés comme mots entiers dans le titre puis les étiquettes).
/// Premier groupe qui correspond gagne ; sinon `autres`. Les mots-clés viennent des vrais titres
/// et étiquettes du site ; ceux sans effectif aujourd'hui (Debian, Fedora, Windows 10...) sont
/// prêts pour les prochains tutoriels.
type Rule = (&'static str, &'static str, &'static [&'static str]);

fn rules(category: &str) -> &'static [Rule] {
    match category {
        "linux" => &[
            ("ubuntu", "Ubuntu", &["ubuntu", "ubuntu server", "netplan", "ppa"]),
            ("debian", "Debian", &["debian", "raspbian", "raspberry pi os"]),
            ("fedora", "Fedora", &["fedora", "dnf"]),
            ("arch", "Arch", &["arch", "arch linux", "pacman", "manjaro"]),
            ("mint", "Linux Mint", &["linux mint", "mint"]),
            ("opensuse", "openSUSE", &["opensuse", "suse", "zypper"]),
        ],
        "windows" => &[
            ("win11", "Windows 11", &["windows 11"]),
            ("win10", "Windows 10", &["windows 10"]),
            ("server", "Windows Server", &["windows server"]),
        ],
        "android" => &[
            ("samsung", "Samsung", &["samsung", "galaxy", "one ui"]),
        ],
        "cmd-powershell" => &[
            ("powershell", "PowerShell", &["powershell"]),
            ("cmd", "CMD", &["cmd", "invite de commandes", "batch"]),
        ],
        "programmation" => &[
            ("python", "Python", &["python", "pip", "venv"]),
            ("javascript", "JavaScript", &["javascript", "nodejs", "node js", "npm", "typescript"]),
            ("web", "Web (HTML / CSS)", &["html", "css", "seo"]),
            ("git", "Git et GitHub", &["git", "github"]),
            ("sql", "SQL", &["sql", "base de donnees"]),
        ],
        _ => &[],
    }
}

/// Minuscules sans accents ni marques de combinaison.
fn fold(s: &str) -> String {
    s.nfkd().filter(|c| !is_combining_mark(*c)).flat_map(char::to_lowercase).collect()
}

/// `kw` présent dans `hay` comme mot entier (bornes non alphanumériques).
fn has_word(hay: &str, kw: &str) -> bool {
    let mut from = 0;
    while let Some(p) = hay[from..].find(kw) {
        let a = from + p;
        let b = a + kw.len();
        let before = hay[..a].chars().next_back().is_none_or(|c| !c.is_alphanumeric());
        let after = hay[b..].chars().next().is_none_or(|c| !c.is_alphanumeric());
        if before && after {
            return true;
        }
        from = a + hay[a..].chars().next().map_or(1, char::len_utf8);
    }
    false
}

/// Clé de groupe d'un tutoriel (`autres` si aucune règle ne correspond).
pub fn group_of(category: &str, title: &str, tags: &[String]) -> &'static str {
    let t = fold(title);
    let tg: Vec<String> = tags.iter().map(|s| fold(s)).collect();
    for (key, _, kws) in rules(category) {
        if kws.iter().any(|k| has_word(&t, k) || tg.iter().any(|x| x == k)) {
            return key;
        }
    }
    "autres"
}

// ─── Construction du cache ───────────────────────────────────────────────────

/// Ré-ancre une URL de média sur l'hôte tuto : chemin relatif, ou absolue vers ce seul hôte.
/// Tout le reste (autre hôte, schéma non http(s), identifiants, port) est refusé.
pub fn anchor_video(raw: &str) -> Option<String> {
    let base = reqwest::Url::parse(&format!("https://{HOST}/")).ok()?;
    let u = reqwest::Url::options().base_url(Some(&base)).parse(raw.trim()).ok()?;
    let ok = matches!(u.scheme(), "http" | "https")
        && u.host_str() == Some(HOST)
        && (u.path().starts_with("/videos/") || u.path().starts_with("/uploads/"))
        && u.port().is_none()
        && u.username().is_empty()
        && u.password().is_none();
    ok.then(|| format!("https://{HOST}{}{}", u.path(), u.query().map(|q| format!("?{q}")).unwrap_or_default()))
}

/// Adresse de la miniature d'un film : même chemin, `.mp4` remplacé par `.thumb.jpg` (déjà ancrée sur l'hôte du site).
pub fn thumbnail_of(video_url: &str) -> Option<String> {
    let no_query = video_url.split('?').next()?;
    no_query.strip_suffix(".mp4").map(|stem| format!("{stem}.thumb.jpg"))
}

fn build_snapshot(raws: Vec<Raw>) -> Snapshot {
    let mut items = Vec::with_capacity(raws.len());
    let mut seen = std::collections::HashSet::new();
    for r in raws {
        let Some(video_url) = r.video_url.as_deref().and_then(anchor_video) else { continue };
        if !r.published || !seen.insert(r.slug.clone()) {
            continue;
        }
        let tags: Vec<String> = r.tags.into_iter().map(|t| t.tag.name).collect();
        let description = r.description.unwrap_or_default();
        let group = group_of(&r.category.slug, &r.title, &tags).to_string();
        let haystack = fold(&format!("{}\n{}\n{}", r.title, description, tags.join("\n")));
        items.push(Item {
            slug: r.slug,
            title: r.title,
            description,
            category: Cat { slug: r.category.slug, name: r.category.name, icon: r.category.icon.unwrap_or_else(|| "📚".into()) },
            group,
            tags,
            thumbnail_url: thumbnail_of(&video_url),
            video_url,
            created_at: r.created_at,
            content_html: r.content.unwrap_or_default(),
            haystack,
        });
    }
    let catalog = build_catalog(&items);
    Snapshot { items, catalog }
}

fn build_catalog(items: &[Item]) -> Value {
    let mut cats: Vec<(Cat, usize, HashMap<String, usize>)> = Vec::new();
    for it in items {
        let i = match cats.iter().position(|c| c.0.slug == it.category.slug) {
            Some(i) => i,
            None => {
                cats.push((it.category.clone(), 0, HashMap::new()));
                cats.len() - 1
            }
        };
        cats[i].1 += 1;
        *cats[i].2.entry(it.group.clone()).or_default() += 1;
    }
    cats.sort_by_key(|c| fold(&c.0.name));
    let out: Vec<Value> = cats
        .into_iter()
        .map(|(cat, count, mut by_group)| {
            let mut groups: Vec<Value> = rules(&cat.slug)
                .iter()
                .filter_map(|(key, label, _)| by_group.remove(*key).map(|n| json!({ "key": key, "label": label, "count": n })))
                .collect();
            // Pas de groupe « Autres » seul : il ne filtrerait rien.
            if let Some(n) = by_group.remove("autres").filter(|_| !groups.is_empty()) {
                groups.push(json!({ "key": "autres", "label": "Autres", "count": n }));
            }
            json!({ "slug": cat.slug, "name": cat.name, "icon": cat.icon, "count": count, "groups": groups })
        })
        .collect();
    json!({ "categories": out })
}

// ─── Filtre et pagination ────────────────────────────────────────────────────

#[derive(Default)]
pub struct Filter<'a> {
    pub category: Option<&'a str>,
    pub group: Option<&'a str>,
    pub q: &'a str,
    pub page: usize,
    pub per_page: usize,
}

/// Éléments de la page demandée et total filtré.
pub fn select<'a>(items: &'a [Item], f: &Filter) -> (Vec<&'a Item>, usize) {
    let terms: Vec<String> = fold(f.q).split_whitespace().map(str::to_string).collect();
    let matched: Vec<&Item> = items
        .iter()
        .filter(|i| f.category.is_none_or(|c| i.category.slug == c))
        .filter(|i| f.group.is_none_or(|g| i.group == g))
        .filter(|i| terms.iter().all(|t| i.haystack.contains(t.as_str())))
        .collect();
    let total = matched.len();
    let start = f.page.saturating_sub(1).saturating_mul(f.per_page);
    (matched.into_iter().skip(start).take(f.per_page).collect(), total)
}

// ─── Cache mémoire avec repli sur le périmé ──────────────────────────────────

pub struct Cache {
    slot: tokio::sync::RwLock<Option<(Instant, Arc<Snapshot>)>>,
    refresh: tokio::sync::Mutex<()>,
}

impl Cache {
    pub const fn new() -> Self {
        Self { slot: tokio::sync::RwLock::const_new(None), refresh: tokio::sync::Mutex::const_new(()) }
    }

    /// Cache frais, sinon recharge (une seule à la fois) ; recharge en échec : périmé si présent.
    pub async fn get<F, Fut>(&self, ttl: Duration, load: F) -> Option<Arc<Snapshot>>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Option<Snapshot>>,
    {
        if let Some((at, s)) = &*self.slot.read().await {
            if at.elapsed() < ttl {
                return Some(s.clone());
            }
        }
        let _one = self.refresh.lock().await;
        // Une autre requête a pu recharger pendant l'attente du verrou.
        if let Some((at, s)) = &*self.slot.read().await {
            if at.elapsed() < ttl {
                return Some(s.clone());
            }
        }
        match load().await {
            Some(snap) => {
                let s = Arc::new(snap);
                *self.slot.write().await = Some((Instant::now(), s.clone()));
                Some(s)
            }
            None => self.slot.read().await.as_ref().map(|(_, s)| s.clone()),
        }
    }
}

static CACHE: Cache = Cache::new();

fn client() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    // Pas de redirection : l'hôte reste celui des constantes.
    C.get_or_init(|| {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("ForgeChat/1.0 (https://forgechat.heiphaistos.org)")
            .timeout(Duration::from_secs(10))
            .build()
            .expect("client tutoriels")
    })
}

async fn fetch_all() -> Option<Snapshot> {
    let mut raws: Vec<Raw> = Vec::new();
    let mut total = usize::MAX;
    for page in 1..=MAX_API_PAGES {
        let url = format!("{API_PAGE}?page={page}&perPage={API_PER_PAGE}");
        let resp = client().get(url).send().await.map_err(|e| tracing::warn!("tutoriels: requête: {e}")).ok()?;
        if !resp.status().is_success() {
            tracing::warn!("tutoriels: statut {}", resp.status());
            return None;
        }
        let body = crate::net_guard::read_capped(resp, MAX_PAGE_BYTES).await?;
        let p: RawPage = serde_json::from_slice(&body).map_err(|e| tracing::warn!("tutoriels: JSON: {e}")).ok()?;
        total = p.total;
        let n = p.items.len();
        raws.extend(p.items);
        if n == 0 || raws.len() >= total {
            break;
        }
    }
    // Liste tronquée (garde-fou atteint ou pages vides) : mieux vaut garder l'ancien cache.
    (raws.len() >= total).then(|| build_snapshot(raws)).filter(|s| !s.items.is_empty())
}

async fn snapshot() -> Result<Arc<Snapshot>> {
    CACHE.get(CACHE_TTL, fetch_all).await.ok_or_else(|| AppError::Unavailable("Tutoriels indisponibles pour le moment".into()))
}

// ─── Routes ──────────────────────────────────────────────────────────────────

fn valid_key(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
}

fn valid_slug(s: &str) -> bool {
    !s.is_empty() && s.len() <= 200 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

async fn limit(state: &AppState, claims: &Claims) -> Result<()> {
    crate::handlers::auth_v2::hit(state, &format!("tutorials_rl:{}", claims.sub), RATE_PER_MINUTE, 60).await
}

pub async fn catalog(State(state): State<AppState>, Extension(claims): Extension<Claims>) -> Result<Json<Value>> {
    limit(&state, &claims).await?;
    Ok(Json(snapshot().await?.catalog.clone()))
}

#[derive(Deserialize)]
pub struct ListQuery {
    category: Option<String>,
    group: Option<String>,
    q: Option<String>,
    page: Option<String>,
    per_page: Option<String>,
}

pub async fn list(State(state): State<AppState>, Extension(claims): Extension<Claims>, Query(p): Query<ListQuery>) -> Result<Json<Value>> {
    let key = |v: &Option<String>| -> Result<Option<String>> {
        match v.as_deref().filter(|s| !s.is_empty()) {
            Some(s) if valid_key(s) => Ok(Some(s.to_string())),
            Some(_) => Err(AppError::BadRequest("Filtre invalide".into())),
            None => Ok(None),
        }
    };
    let num = |v: &Option<String>, def: usize| -> Result<usize> {
        match v.as_deref().filter(|s| !s.is_empty()) {
            Some(s) => s.parse::<usize>().ok().filter(|n| *n >= 1 && *n <= 1_000_000).ok_or_else(|| AppError::BadRequest("Pagination invalide".into())),
            None => Ok(def),
        }
    };
    let category = key(&p.category)?;
    let group = key(&p.group)?;
    let q = p.q.unwrap_or_default();
    if q.chars().count() > MAX_QUERY_CHARS {
        return Err(AppError::BadRequest("Recherche trop longue".into()));
    }
    let page = num(&p.page, 1)?;
    let per_page = num(&p.per_page, DEFAULT_PER_PAGE)?.min(MAX_PER_PAGE);
    limit(&state, &claims).await?;
    let snap = snapshot().await?;
    let (items, total) = select(&snap.items, &Filter { category: category.as_deref(), group: group.as_deref(), q: &q, page, per_page });
    Ok(Json(json!({ "items": items, "total": total, "page": page, "per_page": per_page })))
}

pub async fn detail(State(state): State<AppState>, Extension(claims): Extension<Claims>, Path(slug): Path<String>) -> Result<Json<Value>> {
    if !valid_slug(&slug) {
        return Err(AppError::BadRequest("Identifiant invalide".into()));
    }
    limit(&state, &claims).await?;
    let snap = snapshot().await?;
    let it = snap.items.iter().find(|i| i.slug == slug).ok_or_else(|| AppError::NotFound("Tutoriel introuvable".into()))?;
    let mut v = serde_json::to_value(it).map_err(|e| AppError::Internal(e.into()))?;
    v["content_html"] = Value::String(it.content_html.clone());
    Ok(Json(v))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(title: &str, cat: (&str, &str), tags: &[&str], video: Option<&str>) -> Raw {
        Raw {
            title: title.into(),
            slug: fold(title).replace(' ', "-"),
            description: Some("Desc".into()),
            content: Some("<p>x</p>".into()),
            video_url: video.map(Into::into),
            published: true,
            created_at: "2026-10-09T13:38:09.961Z".into(),
            category: RawCat { slug: cat.0.into(), name: cat.1.into(), icon: Some("X".into()) },
            tags: tags.iter().map(|t| RawTagLink { tag: RawTag { name: (*t).into() } }).collect(),
        }
    }

    fn v(s: &str) -> Option<&str> {
        Some(s)
    }

    fn sample() -> Snapshot {
        let lin = ("linux", "Linux");
        let win = ("windows", "Windows");
        build_snapshot(vec![
            raw("Ubuntu : installer VS Code et Google Chrome (avec mises à jour)", lin, &["linux", "ubuntu", "installation"], v("/videos/tutos/a.mp4")),
            raw("Linux : écrire son premier script bash", lin, &["linux", "script", "bash"], v("/videos/tutos/b.mp4")),
            raw("Ubuntu Server : configurer une adresse IP fixe avec Netplan", lin, &["réseau", "linux", "ubuntu server"], v("/videos/tutos/c.mp4")),
            raw("Linux : surveiller avec watch, ralentir avec nice", lin, &["processus", "linux", "ppa"], v("/videos/tutos/d.mp4")),
            raw("Démarrer Windows 11 en mode sans échec", win, &["démarrage", "windows"], v("/videos/tutos/e.mp4")),
            raw("Réparer Windows avec DISM et SFC", win, &["windows", "commandes"], v("/videos/tutos/f.mp4")),
            raw("Vérifier le TPM 2.0 (compatibilité)", win, &["windows", "windows 11", "tpm"], v("/videos/tutos/g.mp4")),
            raw("Tutoriel texte seul", win, &["windows"], None),
            raw("Vidéo ailleurs", win, &["windows"], v("https://evil.example/x.mp4")),
        ])
    }

    #[test]
    fn grouping_on_real_titles_and_tags() {
        let t = |s: &str| vec![s.to_string()];
        assert_eq!(group_of("linux", "Ubuntu : les raccourcis clavier essentiels", &t("gnome")), "ubuntu");
        assert_eq!(group_of("linux", "Linux : installer MariaDB", &["linux".into(), "ubuntu server".into()]), "ubuntu");
        assert_eq!(group_of("linux", "Linux : écrire son premier script bash", &t("bash")), "autres");
        assert_eq!(group_of("linux", "Installer Debian 12 sur un PC", &t("linux")), "debian");
        assert_eq!(group_of("linux", "Linux : un terminal plus agréable avec zsh", &t("zsh")), "autres");
        assert_eq!(group_of("windows", "Windows 11 : désactiver les widgets, Copilot", &t("windows")), "win11");
        assert_eq!(group_of("windows", "Vérifier le TPM 2.0", &["windows".into(), "windows 11".into()]), "win11");
        assert_eq!(group_of("windows", "Réparer Windows avec DISM et SFC", &t("windows")), "autres");
        assert_eq!(group_of("cmd-powershell", "Le Registre avec PowerShell", &t("cmd")), "powershell");
        assert_eq!(group_of("programmation", "Python : créer un environnement virtuel", &t("pip")), "python");
        assert_eq!(group_of("discord", "Discord : créer un serveur", &t("discord")), "autres");
    }

    #[test]
    fn whole_words_only() {
        // « arch » ne doit pas matcher « search » ni « architecture », « git » pas « digital ».
        assert_eq!(group_of("linux", "Linux : search et architecture des dossiers", &[]), "autres");
        assert_eq!(group_of("programmation", "Un outil digital", &[]), "autres");
        assert_eq!(group_of("linux", "Installer Arch Linux", &[]), "arch");
    }

    #[test]
    fn snapshot_filters_and_catalog() {
        let s = sample();
        assert_eq!(s.items.len(), 7, "sans vidéo ou hors hôte tuto : écartés");
        assert!(s.items.iter().all(|i| i.video_url.starts_with("https://tuto.heiphaistos.org/videos/tutos/")));
        assert!(s.items.iter().all(|i| i.thumbnail_url.as_deref().is_some_and(|t| t.starts_with("https://tuto.heiphaistos.org/videos/tutos/") && t.ends_with(".thumb.jpg"))));
        assert_eq!(thumbnail_of("https://tuto.heiphaistos.org/videos/tutos/a.mp4?x=1").as_deref(), Some("https://tuto.heiphaistos.org/videos/tutos/a.thumb.jpg"));
        assert_eq!(thumbnail_of("https://tuto.heiphaistos.org/videos/tutos/a.webm"), None);
        let cats = s.catalog["categories"].as_array().unwrap();
        assert_eq!(cats.len(), 2);
        let lin = &cats[0];
        assert_eq!(lin["slug"], "linux");
        assert_eq!(lin["count"], 4);
        let g = lin["groups"].as_array().unwrap();
        assert_eq!((g[0]["key"].as_str().unwrap(), g[0]["count"].as_u64().unwrap()), ("ubuntu", 3));
        assert_eq!((g[1]["key"].as_str().unwrap(), g[1]["count"].as_u64().unwrap()), ("autres", 1));
        let win = &cats[1];
        assert_eq!(win["groups"][0]["key"], "win11");
        assert_eq!(win["groups"][0]["count"], 2);
        // catégorie sans règle : pas de groupes
        let s2 = build_snapshot(vec![raw("Discord : un salon", ("discord", "Discord"), &[], v("/videos/tutos/z.mp4"))]);
        assert!(s2.catalog["categories"][0]["groups"].as_array().unwrap().is_empty());
    }

    #[test]
    fn video_anchored_on_tuto_host() {
        assert_eq!(anchor_video("/videos/tutos/a.mp4").unwrap(), "https://tuto.heiphaistos.org/videos/tutos/a.mp4");
        assert_eq!(anchor_video("http://tuto.heiphaistos.org/videos/a.mp4?x=1").unwrap(), "https://tuto.heiphaistos.org/videos/a.mp4?x=1");
        for bad in ["https://evil.example/a.mp4", "//evil.example/a.mp4", "https://tuto.heiphaistos.org.evil.example/a", "https://tuto.heiphaistos.org@evil.example/a", "https://u:p@tuto.heiphaistos.org/a", "https://tuto.heiphaistos.org:8443/a", "javascript:alert(1)", "ftp://tuto.heiphaistos.org/a", ""] {
            assert!(anchor_video(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn filter_search_and_pagination() {
        let s = sample();
        let f = |category, group, q, page, per_page| Filter { category, group, q, page, per_page };
        assert_eq!(select(&s.items, &f(None, None, "", 1, 60)).1, 7);
        assert_eq!(select(&s.items, &f(Some("linux"), None, "", 1, 60)).1, 4);
        assert_eq!(select(&s.items, &f(Some("linux"), Some("ubuntu"), "", 1, 60)).1, 3);
        assert_eq!(select(&s.items, &f(Some("windows"), Some("ubuntu"), "", 1, 60)).1, 0);
        // titre, étiquette, sans accents, plusieurs termes (ET)
        assert_eq!(select(&s.items, &f(None, None, "NETPLAN", 1, 60)).1, 1);
        assert_eq!(select(&s.items, &f(None, None, "demarrer sans echec", 1, 60)).1, 1);
        assert_eq!(select(&s.items, &f(None, None, "tpm", 1, 60)).1, 1);
        assert_eq!(select(&s.items, &f(None, None, "desc", 1, 60)).1, 7, "description");
        assert_eq!(select(&s.items, &f(None, None, "netplan windows", 1, 60)).1, 0);
        // pagination
        let (p1, total) = select(&s.items, &f(None, None, "", 1, 3));
        assert_eq!((p1.len(), total), (3, 7));
        assert_eq!(select(&s.items, &f(None, None, "", 3, 3)).0.len(), 1);
        assert_eq!(select(&s.items, &f(None, None, "", 4, 3)).0.len(), 0);
        assert_eq!(select(&s.items, &f(None, None, "", usize::MAX, usize::MAX)).0.len(), 0);
    }

    #[test]
    fn param_validation() {
        assert!(valid_key("cmd-powershell") && valid_key("win11"));
        assert!(!valid_key("") && !valid_key("a b") && !valid_key("A") && !valid_key("../x") && !valid_key(&"a".repeat(65)));
        assert!(valid_slug("Desactiver-widgets_1") && !valid_slug("a/b") && !valid_slug("a?b"));
    }

    #[tokio::test]
    async fn cache_fresh_stale_and_failure() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let c = Cache::new();
        let calls = AtomicUsize::new(0);
        let ok = || async {
            calls.fetch_add(1, Ordering::SeqCst);
            Some(sample())
        };
        // Rien en cache et site injoignable : None.
        assert!(c.get(Duration::from_secs(600), || async { None }).await.is_none());
        let a = c.get(Duration::from_secs(600), ok).await.unwrap();
        // Frais : pas de nouvel appel.
        let b = c.get(Duration::from_secs(600), ok).await.unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(Arc::ptr_eq(&a, &b));
        // Périmé + site en panne : on sert le périmé.
        let s = c.get(Duration::ZERO, || async { None }).await.unwrap();
        assert!(Arc::ptr_eq(&a, &s));
        // Périmé + site revenu : rechargé.
        let n = c.get(Duration::ZERO, ok).await.unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert!(!Arc::ptr_eq(&a, &n));
    }
}
