-- Entités HTML restées dans les titres et résumés déjà rangés (« I&#8217;ve », « &hellip; ») : même décodage
-- que audit::decode_entities pour les numériques et les noms courants. Les nouveaux articles sont décodés à l'arrivée.
CREATE FUNCTION pg_temp.news_unescape(t text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE m text[]; n bigint;
BEGIN
  IF t IS NULL OR position('&' in t) = 0 THEN RETURN t; END IF;
  LOOP
    m := regexp_match(t, '&#([0-9]{1,7});');
    EXIT WHEN m IS NULL;
    n := m[1]::bigint;
    t := replace(t, '&#' || m[1] || ';', CASE WHEN n BETWEEN 1 AND 1114111 AND n NOT BETWEEN 55296 AND 57343
                                             THEN CASE WHEN n = 160 THEN ' ' ELSE chr(n::int) END ELSE '' END);
  END LOOP;
  LOOP
    m := regexp_match(t, '&#[xX]([0-9a-fA-F]{1,6});');
    EXIT WHEN m IS NULL;
    n := ('x' || lpad(m[1], 8, '0'))::bit(32)::bigint;
    t := regexp_replace(t, '&#[xX]' || m[1] || ';', CASE WHEN n BETWEEN 1 AND 1114111 AND n NOT BETWEEN 55296 AND 57343
                                                       THEN chr(n::int) ELSE '' END, 'g');
  END LOOP;
  RETURN replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
           t, '&rsquo;', '’'), '&lsquo;', '‘'), '&rdquo;', '”'), '&ldquo;', '“'), '&hellip;', '…'), '&ndash;', '–'),
           '&mdash;', '—'), '&nbsp;', ' '), '&quot;', '"'), '&apos;', ''''), '&lt;', '<'), '&gt;', '>'), '&amp;', '&');
END $$;

UPDATE news_articles SET title = pg_temp.news_unescape(title), summary = pg_temp.news_unescape(summary)
 WHERE title ~ '&[#a-zA-Z0-9]{2,8};' OR summary ~ '&[#a-zA-Z0-9]{2,8};';
