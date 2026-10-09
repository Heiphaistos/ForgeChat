-- Résumés coupés au milieu d'une balise (« <a href="… » sans « > ») : la migration 102 ne retirait que les
-- balises complètes. On retire la balise ouvrante finale, puis toute balise restante.
UPDATE news_articles
   SET summary = NULLIF(btrim(regexp_replace(regexp_replace(regexp_replace(summary, '<[^>]*$', ''), '<[^>]*>', ' ', 'g'), '\s+', ' ', 'g')), '')
 WHERE summary ~ '<[a-zA-Z/!]';
