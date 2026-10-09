-- Actualités : articles des flux RSS de RSSDI (bot du serveur), publiés dans les fils de forum du serveur
-- et, pour les sites publics, sur la page « Actualités » ouverte à tous les comptes (handlers/news.rs).
CREATE TABLE IF NOT EXISTS news_sites (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id  UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    category   TEXT NOT NULL,
    public     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (server_id, name)
);

CREATE TABLE IF NOT EXISTS news_articles (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id      UUID NOT NULL REFERENCES news_sites(id) ON DELETE CASCADE,
    link         TEXT NOT NULL,
    title        TEXT NOT NULL,
    summary      TEXT,
    image        TEXT,
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (site_id, link)
);
CREATE INDEX IF NOT EXISTS idx_news_articles_site_date ON news_articles (site_id, published_at DESC);
