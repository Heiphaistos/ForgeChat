// Mentions en métadonnées et AutoMod côté appli : mêmes cas que client/scripts/channelText.test.mjs.
import { automodBlock, containsWord, firstUrl, linkHosts, mentionMeta, previewAllowed, previewUrl } from '@/e2e/channelText'

const U = '11111111-1111-4111-8111-111111111111'
const R = '22222222-2222-4222-8222-222222222222'

test('mentions : jetons, @everyone/@here, rien dans le code', () => {
  const m = mentionMeta(`Salut <@${U}> et <@&${R}>, @everyone ! \`<@${R.replace('2', '3')}>\` mail@here.fr`)
  expect(m.mentions).toEqual([U])
  expect(m.mention_roles).toEqual([R])
  expect(m.mention_everyone).toBe(true)
  expect(m.mention_here).toBe(false)
  expect(mentionMeta('```\n@here\n```').mention_here).toBe(false)
  expect(mentionMeta('(@here)').mention_here).toBe(true)
})

const rules = { enabled: true, blocked_words: ['hell', 'gros mot'], max_mentions: 2, max_links: 1, anti_spam: true, anti_caps: true }

test('AutoMod : mêmes règles que le serveur', () => {
  expect(automodBlock(rules, 'hello shell')).toBeNull()
  expect(automodBlock(rules, 'Go to HELL!')).toBe('word')
  expect(automodBlock(rules, 'un gros mot ici')).toBe('word')
  expect(automodBlock(rules, '@a @b @c')).toBe('mentions')
  expect(automodBlock(rules, 'https://a.fr http://b.fr')).toBe('links')
  expect(automodBlock(rules, 'CECI EST EN MAJUSCULES')).toBe('caps')
  const now = 100_000
  expect(automodBlock(rules, 'spam', [{ text: 'spam', at: now - 1000 }, { text: 'spam', at: now - 2000 }], now)).toBe('spam')
  expect(automodBlock({ ...rules, enabled: false }, 'hell')).toBeNull()
  expect(containsWord('michelle', 'hell')).toBe(false)
  expect(firstUrl('voir https://forgechat.fr/a puis')).toBe('https://forgechat.fr/a')
})

test('AutoMod : liens dangereux (liste locale), mêmes cas que le web', () => {
  const r = { ...rules, max_links: 0, dangerous_domains: ['grabify.link', 'mauvais.example'] }
  expect(automodBlock(r, 'regarde https://grabify.link/abc')).toBe('dangerous_link')
  expect(automodBlock(r, 'www.Mauvais.Example/x')).toBe('dangerous_link')
  expect(automodBlock(r, 'http://cdn.mauvais.example')).toBe('dangerous_link')
  expect(automodBlock(r, 'https://pasmauvais.example et grabify.link sans lien')).toBeNull()
  expect(automodBlock({ ...r, dangerous_domains: [] }, 'https://grabify.link')).toBeNull()
  expect(linkHosts('https://user@a.fr:8080/x http://www.b.fr.')).toEqual(['a.fr', 'b.fr'])
  expect(automodBlock(r, 'https://google.com@grabify.link/x')).toBe('dangerous_link')
})

test("aperçu : tout site public part à /og, jamais une adresse locale ni un schéma exotique", () => {
  for (const ok of ['https://github.com/a/b', 'https://exemple.com/secret', 'http://blog.exemple.fr/x?y=1', 'https://xn--bcher-kva.example/']) {
    expect(previewAllowed(ok)).toBe(true)
  }
  for (const ko of ['http://127.0.0.1/', 'http://localhost/x', 'https://nas.local/', 'http://x.internal/', 'http://[::1]/', 'http://10.0.0.1/', 'javascript:alert(1)', 'data:text/html,x', 'pas une url', 'ftp://github.com/']) {
    expect(previewAllowed(ko)).toBe(false)
  }
})

test("aperçu : lien visible seulement (pas de code, spoiler, média), ponctuation retirée, plusieurs liens = le premier", () => {
  expect(previewUrl('voir https://a.fr/x. Puis https://b.fr')).toBe('https://a.fr/x')
  expect(previewUrl('[texte](https://a.fr/p?q=1) fin')).toBe('https://a.fr/p?q=1')
  expect(previewUrl('(https://a.fr/x), ok')).toBe('https://a.fr/x')
  expect(previewUrl('https://fr.wikipedia.org/wiki/Foo_(bar)')).toBe('https://fr.wikipedia.org/wiki/Foo_(bar)')
  expect(previewUrl('`https://code.fr` puis https://b.fr')).toBe('https://b.fr')
  expect(previewUrl('```\nhttps://code.fr\n```\nhttps://b.fr')).toBe('https://b.fr')
  expect(previewUrl('||https://secret.fr|| rien')).toBe(null)
  expect(previewUrl('https://a.fr/img.PNG')).toBe(null)
  expect(previewUrl('https://a.fr/page.html')).toBe('https://a.fr/page.html')
  expect(previewUrl('aucun lien')).toBe(null)
  expect(firstUrl('<https://a.fr/x>')).toBe('https://a.fr/x')
})
