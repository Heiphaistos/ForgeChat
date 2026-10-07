// Mentions en métadonnées et AutoMod côté appli : node --test scripts/channelText.test.mjs
// Le mobile vérifie les mêmes cas (mobile/__tests__/channel-text.test.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { automodBlock, containsWord, firstUrl, linkHosts, mentionMeta } from '../src/e2e/channelText.ts'

const U = '11111111-1111-4111-8111-111111111111'
const R = '22222222-2222-4222-8222-222222222222'

test('mentions : jetons, @everyone/@here, rien dans le code', () => {
  const m = mentionMeta(`Salut <@${U}> et <@&${R}>, @everyone ! \`<@${R.replace('2', '3')}>\` mail@here.fr`)
  assert.deepEqual(m.mentions, [U])
  assert.deepEqual(m.mention_roles, [R])
  assert.equal(m.mention_everyone, true)
  assert.equal(m.mention_here, false)
  assert.equal(mentionMeta('```\n@here\n```').mention_here, false)
  assert.equal(mentionMeta('(@here)').mention_here, true)
  assert.deepEqual(mentionMeta(`<@${U}> <@!${U}>`).mentions, [U])
})

const rules = { enabled: true, blocked_words: ['hell', 'gros mot'], max_mentions: 2, max_links: 1, anti_spam: true, anti_caps: true }

test('AutoMod : mêmes règles que le serveur', () => {
  assert.equal(automodBlock(rules, 'hello shell'), null)
  assert.equal(automodBlock(rules, 'Go to HELL!'), 'word')
  assert.equal(automodBlock(rules, 'un gros mot ici'), 'word')
  assert.equal(automodBlock(rules, '@a @b @c'), 'mentions')
  assert.equal(automodBlock(rules, 'https://a.fr http://b.fr'), 'links')
  assert.equal(automodBlock(rules, 'CECI EST EN MAJUSCULES'), 'caps')
  assert.equal(automodBlock(rules, 'COURT'), null)
  const now = 100_000
  const recent = [{ text: 'spam', at: now - 1000 }, { text: 'spam', at: now - 2000 }]
  assert.equal(automodBlock(rules, 'spam', recent, now), 'spam')
  assert.equal(automodBlock(rules, 'spam', recent.slice(1), now), null)
  assert.equal(automodBlock({ ...rules, enabled: false }, 'hell'), null)
  assert.equal(automodBlock(null, 'hell'), null)
  assert.equal(containsWord('michelle', 'hell'), false)
})

test('première URL', () => {
  assert.equal(firstUrl('voir https://forgechat.fr/a?b=1 puis http://x.fr'), 'https://forgechat.fr/a?b=1')
  assert.equal(firstUrl('rien'), null)
})

test('AutoMod : liens dangereux (liste locale), sous-domaines compris', () => {
  const r = { ...rules, max_links: 0, dangerous_domains: ['grabify.link', 'mauvais.example'] }
  assert.equal(automodBlock(r, 'regarde https://grabify.link/abc'), 'dangerous_link')
  assert.equal(automodBlock(r, 'www.Mauvais.Example/x'), 'dangerous_link')
  assert.equal(automodBlock(r, 'http://cdn.mauvais.example'), 'dangerous_link')
  assert.equal(automodBlock(r, 'https://pasmauvais.example et grabify.link sans lien'), null)
  assert.equal(automodBlock({ ...r, dangerous_domains: [] }, 'https://grabify.link'), null)
  assert.deepEqual(linkHosts('https://user@a.fr:8080/x http://www.b.fr.'), ['a.fr', 'b.fr'])
  assert.equal(automodBlock(r, 'https://google.com@grabify.link/x'), 'dangerous_link')
})
