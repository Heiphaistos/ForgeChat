// Fonctions « façon Discord » (lot E1) : node --test scripts/discordFeatures.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  moveId, applyCategoryPositions, mergeCategory, parseUnreadEvent, applyUnreadPatch,
  forumSettingsPatch, publicAccounts,
} from '../src/lib/discordFeatures.ts'
import * as dict from '../src/i18n/parts/discordFeatures.ts'
import { fr } from '../src/i18n/fr.ts'
import { en } from '../src/i18n/en.ts'

test('moveId : monter / descendre, bornes = null', () => {
  assert.deepEqual(moveId(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c'])
  assert.deepEqual(moveId(['a', 'b', 'c'], 'b', 1), ['a', 'c', 'b'])
  assert.equal(moveId(['a', 'b'], 'a', -1), null)
  assert.equal(moveId(['a', 'b'], 'b', 1), null)
  assert.equal(moveId(['a'], 'x', 1), null)
})

test('CATEGORIES_REORDER : seuls les ids reçus bougent, puis tri', () => {
  const cats = [{ id: 'a', name: 'A', position: 0 }, { id: 'staff', name: 'S', position: 1 }, { id: 'b', name: 'B', position: 2 }]
  const out = applyCategoryPositions(cats, [{ id: 'b', position: 0 }, { id: 'a', position: 3 }, { id: 'zz', position: 9 }, { id: 'bad' }])
  assert.deepEqual(out.map(c => `${c.id}:${c.position}`), ['b:0', 'staff:1', 'a:3'])
  assert.deepEqual(applyCategoryPositions(cats, 'nope').map(c => c.id), ['a', 'staff', 'b'])
  assert.equal(cats[0].position, 0, 'entrée non modifiée')
})

test('CATEGORY_UPDATE : nom et position fusionnés, champs invalides ignorés', () => {
  const cats = [{ id: 'a', name: 'A', position: 0, staff_only: false }, { id: 'b', name: 'B', position: 1, staff_only: false }]
  const out = mergeCategory(cats, { id: 'a', name: 'Annonces', position: 5 })
  assert.deepEqual(out.map(c => `${c.id}:${c.name}:${c.position}`), ['b:B:1', 'a:Annonces:5'])
  assert.equal(out[1].staff_only, false)
  assert.deepEqual(mergeCategory(cats, { id: 'a', name: 42 }).map(c => c.name), ['A', 'B'])
  assert.deepEqual(mergeCategory(cats, null), cats)
})

test('READ_STATE_UPDATE unread : validation', () => {
  assert.deepEqual(parseUnreadEvent({ unread: true, channel_id: 'c', server_id: 's', count: 3, mention_count: 1 }),
    { channelId: 'c', serverId: 's', count: 3, mentionCount: 1 })
  assert.deepEqual(parseUnreadEvent({ unread: true, channel_id: 'dm', server_id: null, count: 2, mention_count: 2 }),
    { channelId: 'dm', serverId: null, count: 2, mentionCount: 2 })
  assert.equal(parseUnreadEvent({ channel_id: 'c', count: 1, mention_count: 0 }), null, 'sans unread = lu')
  assert.equal(parseUnreadEvent({ unread: true, channel_id: 'c', count: -1, mention_count: 0 }), null)
  assert.equal(parseUnreadEvent({ unread: true, channel_id: 'c', count: 1.5, mention_count: 0 }), null)
  assert.equal(parseUnreadEvent({ unread: true, count: 1, mention_count: 0 }), null)
  assert.equal(parseUnreadEvent(null), null)
})

test('compteurs posés tels quels, total du serveur ajusté par l’écart', () => {
  const s = { counts: { c: 5, d: 1 }, serverCounts: { s: 6 }, mentionCounts: { c: 2 }, serverMentionCounts: { s: 2 }, channelServer: { c: 's', d: 's' } }
  const up = applyUnreadPatch(s, { channelId: 'c', serverId: 's', count: 8, mentionCount: 0 })
  assert.deepEqual(up.counts, { c: 8, d: 1 })
  assert.deepEqual(up.serverCounts, { s: 9 })
  assert.deepEqual(up.mentionCounts, {})
  assert.deepEqual(up.serverMentionCounts, {})
  // Salon inconnu jusque-là, serveur déduit du message ; MP sans serveur.
  const fresh = applyUnreadPatch(s, { channelId: 'e', serverId: null, count: 2, mentionCount: 2 })
  assert.deepEqual(fresh.counts, { c: 5, d: 1, e: 2 })
  assert.deepEqual(fresh.serverCounts, { s: 6 })
  assert.deepEqual(fresh.mentionCounts, { c: 2, e: 2 })
  assert.equal(fresh.channelServer.e, undefined)
  const known = applyUnreadPatch(s, { channelId: 'd', serverId: null, count: 4, mentionCount: 1 })
  assert.deepEqual(known.serverCounts, { s: 9 })
  assert.deepEqual(known.serverMentionCounts, { s: 3 })
})

test('forum-settings : seulement les champs changés, vide = null, CRLF normalisé', () => {
  assert.deepEqual(forumSettingsPatch({ default_reaction_emoji: '👍', post_guidelines: 'a\nb' }, { default_reaction_emoji: '👍', post_guidelines: 'a\r\nb ' }), {})
  assert.deepEqual(forumSettingsPatch({ default_reaction_emoji: '👍', post_guidelines: null }, { default_reaction_emoji: '  ', post_guidelines: 'Règles' }),
    { default_reaction_emoji: null, post_guidelines: 'Règles' })
  assert.deepEqual(forumSettingsPatch({}, { default_reaction_emoji: ':forge:', post_guidelines: '' }), { default_reaction_emoji: ':forge:' })
})

test('comptes connectés publics : forme vérifiée, lien https seulement', () => {
  const out = publicAccounts([
    { platform: 'github', platform_username: 'momo', platform_url: 'https://github.com/momo', verified: true },
    { platform: 'steam', platform_username: 'x', platform_url: 'javascript:alert(1)' },
    { platform: 'twitch', platform_username: '' },
    null, 'x',
  ])
  assert.deepEqual(out, [
    { platform: 'github', platform_username: 'momo', platform_url: 'https://github.com/momo' },
    { platform: 'steam', platform_username: 'x', platform_url: null },
  ])
  assert.deepEqual(publicAccounts(undefined), [])
})

test('i18n : mêmes clés fr/en, branchées dans les dictionnaires', () => {
  assert.deepEqual(Object.keys(dict.en).sort(), Object.keys(dict.fr).sort())
  for (const [k, v] of Object.entries(dict.fr)) {
    assert.equal(fr[k], v, `fr non branché : ${k}`)
    assert.equal(en[k], dict.en[k], `en non branché : ${k}`)
  }
})
