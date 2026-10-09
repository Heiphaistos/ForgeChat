-- Articles déjà rangés : image tirée du HTML du flux ou de la vidéo YouTube, puis résumé converti en texte
-- (les résumés RSS arrivaient en HTML brut, liens compris, et s'affichaient tels quels).
UPDATE news_articles SET image = replace(substring(summary from '<img[^>]+src="(https://[^"]+)"'), '&amp;', '&')
 WHERE image IS NULL AND summary ~* '<img[^>]+src="https://[^"]+"' AND length(substring(summary from '<img[^>]+src="(https://[^"]+)"')) <= 2000;

UPDATE news_articles
   SET image = 'https://i.ytimg.com/vi/' || substring(link from '(?:youtube\.com/watch\?v=|youtube\.com/shorts/|youtu\.be/)([A-Za-z0-9_-]{11})') || '/hqdefault.jpg'
 WHERE image IS NULL AND link ~ '(youtube\.com/watch\?v=|youtube\.com/shorts/|youtu\.be/)[A-Za-z0-9_-]{11}';

UPDATE news_articles
   SET summary = NULLIF(btrim(regexp_replace(
         replace(replace(replace(replace(replace(replace(replace(
           regexp_replace(summary, '<[^>]*>', ' ', 'g'),
           '&quot;', '"'), '&#39;', ''''), '&#039;', ''''), '&lt;', '<'), '&gt;', '>'), '&nbsp;', ' '), '&amp;', '&'),
         '\s+', ' ', 'g')), '')
 WHERE summary ~ '<[a-zA-Z/!]|&[a-z#0-9]+;';
