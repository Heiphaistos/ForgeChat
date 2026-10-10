// Menus contextuels « comme Discord » : node --test scripts/uxMenus.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildUserMenu, buildConvMenu, pinnedFirst, tidy, MUTE_MINUTES } from '../src/components/userMenu/model.ts'
import { fr, en } from '../src/i18n/parts/menus.ts'

const t = (k, v) => (v?.name ? `${k}:${v.name}` : k)
const noop = () => {}
const actions = new Proxy({}, { get: () => noop })
const facts = over => ({
  name: 'alice', relation: 'none', favorite: false, blocked: false, ignored: false, canMention: false,
  dm: null, inviteServers: [], friendGroups: [], volume: null, support: null, moderation: [], ...over,
})
const labels = entries => entries.map(e => (e.separator ? '---' : e.header ?? e.label))

test('séparateurs : jamais en tête, en fin ni en double', () => {
  const S = { separator: true }
  assert.deepEqual(labels(tidy([S, { label: 'a' }, S, S, { label: 'b' }, S])), ['a', '---', 'b'])
})

test('soi-même : ni message, ni appel, ni ami, ni blocage', () => {
  const l = labels(buildUserMenu(facts({ relation: 'self' }), actions, t))
  for (const k of ['msg.sendMessage', 'um.call', 'um.addFriend', 'friends.block', 'um.ignore']) assert.ok(!l.includes(k), k)
  assert.deepEqual(l.slice(0, 2), ['um.profile', 'um.note'])
  assert.deepEqual(l.slice(-3), ['um.viewAvatar', 'um.copyUrl', 'um.copyId'])
})

test('inconnu : ajouter en ami, ignorer, bloquer en rouge', () => {
  const m = buildUserMenu(facts(), actions, t)
  const l = labels(m)
  assert.ok(l.includes('um.addFriend') && l.includes('um.ignore'))
  assert.ok(!l.includes('um.friendNick') && !l.includes('um.favorite'))
  assert.equal(m.find(e => e.label === 'friends.block').danger, true)
  assert.equal(m.find(e => e.label === 'um.note').hint, 'um.onlyYou')
})

test('ami : pseudo d’ami, favoris, groupes cochés, retirer', () => {
  const m = buildUserMenu(facts({ relation: 'friend', favorite: true, friendGroups: [{ id: 'g', name: 'Jeu', member: true }] }), actions, t)
  const l = labels(m)
  assert.ok(l.includes('um.friendNick') && l.includes('um.unfavorite') && l.includes('um.removeFriend'))
  assert.equal(m.find(e => e.label === 'um.groups').submenu[0].checked, true)
})

test('demande reçue / envoyée', () => {
  assert.ok(labels(buildUserMenu(facts({ relation: 'incoming' }), actions, t)).includes('um.acceptFriend'))
  const sent = buildUserMenu(facts({ relation: 'outgoing' }), actions, t).find(e => e.label === 'um.requestSent')
  assert.equal(sent.disabled, true)
})

test('rendre muet : sous-menu des durées seulement avec un MP', () => {
  assert.ok(!labels(buildUserMenu(facts(), actions, t)).some(l => l.startsWith('um.mute')))
  let got = null
  const m = buildUserMenu(facts({ dm: { muted: false } }), { ...actions, mute: x => { got = x } }, t)
  const mute = m.find(e => e.label === 'um.mute:alice')
  assert.deepEqual(mute.submenu.map(e => e.label), MUTE_MINUTES.map(n => `um.mute.${n}`))
  mute.submenu[2].onClick()
  assert.equal(got, 180)
  assert.ok(labels(buildUserMenu(facts({ dm: { muted: true } }), actions, t)).includes('um.unmute:alice'))
})

test('inviter : sous-menu des serveurs, absent sans serveur', () => {
  let got = null
  const m = buildUserMenu(facts({ inviteServers: [{ id: 's1', name: 'Forge' }] }), { ...actions, invite: id => { got = id } }, t)
  const inv = m.find(e => e.label === 'um.invite')
  inv.submenu[0].onClick()
  assert.equal(got, 's1')
  assert.ok(!labels(buildUserMenu(facts(), actions, t)).includes('um.invite'))
})

test('vocal, mention et modération s’insèrent', () => {
  const l = labels(buildUserMenu(facts({
    volume: { label: 'vol' }, canMention: true, moderation: [{ separator: true }, { label: 'mod.kick' }],
  }), actions, t))
  assert.ok(l.indexOf('vol') < l.indexOf('members.mention'))
  assert.ok(l.indexOf('mod.kick') < l.indexOf('um.viewAvatar'))
})

test('conversation : épingler, fermer, groupe muet / quitter', () => {
  const dm = labels(buildConvMenu({ group: false, pinned: true, muted: false, unread: false }, actions, t, [{ label: 'um.profile' }]))
  assert.deepEqual(dm, ['channels.markRead', 'dml.unpin', '---', 'um.profile', '---', 'dms.archive', 'dml.close', '---', 'dml.copyId'])
  const g = labels(buildConvMenu({ group: true, pinned: false, muted: true, unread: true }, actions, t))
  assert.deepEqual(g, ['channels.markRead', 'dml.pin', 'dml.unmuteGroup', '---', 'dms.archive', 'dml.closeGroup', 'dms.leaveGroup', '---', 'dml.copyId'])
})

test('épinglées en tête, ordre conservé', () => {
  const l = [{ id: 1 }, { id: 2, is_pinned: true }, { id: 3 }, { id: 4, is_pinned: true }]
  assert.deepEqual(pinnedFirst(l).map(d => d.id), [2, 4, 1, 3])
})

test('i18n : toute clé anglaise existe en français', () => {
  for (const k of Object.keys(en)) assert.ok(k in fr, k)
  for (const n of MUTE_MINUTES) assert.ok(`um.mute.${n}` in fr)
})
