-- Actualités : métadonnées (image, résumé) cherchées une seule fois sur la page de l'article (handlers/news.rs).
ALTER TABLE news_articles ADD COLUMN IF NOT EXISTS og_checked BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_news_articles_og_todo ON news_articles (published_at DESC) WHERE NOT og_checked;
