// Menus contextuels « comme Discord » : node --test scripts/uxMenus.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildUserMenu, buildModMenu, buildConvMenu, canRenameMember, pinnedFirst, tidy, MUTE_MINUTES } from '../src/components/userMenu/model.ts'
import { fr, en } from '../src/i18n/parts/menus.ts'

const t = (k, v) => (v?.name ? `${k}:${v.name}` : k)
const noop = () => {}
const actions = new Proxy({}, { get: () => noop })
const facts = over => ({
  name: 'alice', relation: 'none', favorite: false, blocked: false, ignored: false, canMention: false,
  dm: null, inviteServers: [], friendGroups: [], volume: null, support: null, moderation: [], voiceLocal: null, canNick: false, ...over,
})
const labels = entries => entries.map(e => (e.separator ? '---' : e.custom ? 'custom' : e.header ?? e.label))

test('séparateurs : jamais en tête, en fin ni en double', () => {
  const S = { separator: true }
  assert.deepEqual(labels(tidy([S, { label: 'a' }, S, S, { label: 'b' }, S])), ['a', '---', 'b'])
})

test('soi-même : ni message, ni appel, ni ami, ni blocage', () => {
  const l = labels(buildUserMenu(facts({ relation: 'self' }), actions, t))
  for (const k of ['msg.sendMessage', 'um.call', 'um.addFriend', 'friends.block', 'um.ignore']) assert.ok(!l.includes(k), k)
  assert.deepEqual(l.slice(0, 2), ['um.profile', 'um.note'])
  assert.deepEqual(l.slice(-3), ['um.copyId', 'um.viewAvatar', 'um.copyUrl'])
  assert.ok(!l.includes('um.verifyCode') && !l.includes('um.changeNick'))
  assert.ok(labels(buildUserMenu(facts({ relation: 'self', canNick: true }), actions, t)).includes('um.changeNick'))
})

test('pseudo d’un autre membre : « Gérer les pseudos » et rang supérieur', () => {
  assert.equal(canRenameMember({ self: false, manage: true, above: true }), true)
  assert.equal(canRenameMember({ self: false, manage: false, above: true }), false)
  assert.equal(canRenameMember({ self: false, manage: true, above: false }), false)
  assert.equal(canRenameMember({ self: true, manage: true, above: true }), false)
  let called = 0
  const m = buildUserMenu(facts({ canNick: true }), { ...actions, nickname: () => { called++ } }, t)
  m.find(e => e.label === 'um.changeNick').onClick()
  assert.equal(called, 1)
  assert.ok(!labels(buildUserMenu(facts(), actions, t)).includes('um.changeNick'))
  for (const k of ['um.nickTitle', 'um.nickReset', 'um.nickSave', 'um.nickChanged', 'um.nickCleared', 'perm.MANAGE_NICKNAMES', 'perm.MANAGE_NICKNAMES.desc', 'audit.MEMBER_NICKNAME_CHANGE']) {
    assert.ok(fr[k] && en[k], k)
  }
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

test('vocal : ordre comme Discord, curseur puis cases locales cochées', () => {
  let got = null
  const m = buildUserMenu(facts({
    relation: 'friend', canMention: true, volume: { custom: 'slider' }, inviteServers: [{ id: 's', name: 'S' }],
    voiceLocal: { muted: true, soundboardMuted: false, videoOff: false },
    moderation: [{ separator: true }, { label: 'mod.kickName:alice' }],
  }), { ...actions, localMute: on => { got = on } }, t)
  const l = labels(m).filter(x => x !== '---')
  assert.deepEqual(l, [
    'um.profile', 'members.mention', 'msg.sendMessage', 'um.call', 'um.note', 'um.friendNick',
    'custom', 'um.localMute', 'um.soundboardMute', 'um.videoOff',
    'um.verifyCode',
    'um.invite', 'um.removeFriend', 'um.favorite', 'um.ignore', 'friends.block',
    'mod.kickName:alice',
    'um.copyId', 'um.viewAvatar', 'um.copyUrl',
  ])
  const mute = m.find(e => e.label === 'um.localMute')
  assert.equal(mute.checked, true)
  mute.onClick()
  assert.equal(got, false)
  assert.equal(m.find(e => e.label === 'um.videoOff').checked, false)
})

test('appel privé : seulement « Rendre muet » parmi les cases locales', () => {
  const l = labels(buildUserMenu(facts({ voiceLocal: { muted: false } }), actions, t))
  assert.ok(l.includes('um.localMute'))
  assert.ok(!l.includes('um.soundboardMute') && !l.includes('um.videoOff'))
})

test('hors vocal : ni cases locales ni curseur', () => {
  const l = labels(buildUserMenu(facts(), actions, t))
  for (const k of ['um.localMute', 'um.soundboardMute', 'um.videoOff', 'custom']) assert.ok(!l.includes(k), k)
  assert.ok(l.includes('um.verifyCode'))
})

const mod = over => ({
  name: 'alice', self: false, above: true, timedOut: false, serverMuted: false, serverDeafened: false,
  currentVoice: 'v1', voiceChannels: [{ id: 'v1', name: 'Général' }, { id: 'v2', name: 'Jeu' }],
  roles: [{ id: 'r1', name: 'Membre', has: true }, { id: 'r2', name: 'VIP', has: false }],
  can: { roles: true, mute: true, deafen: true, move: true, kick: true, ban: true, timeout: true, notes: true, channelPerms: true },
  ...over,
})

test('modération : ordre de Discord, tout permis', () => {
  const m = buildModMenu(mod(), actions, t)
  assert.deepEqual(labels(m), ['---', 'mod.roles', 'mod.moveToMenu', 'mod.channelPerms', 'mod.serverMute', 'mod.serverDeafen',
    'mod.disconnect', 'mod.kickName:alice', 'mod.banName:alice', 'mod.timeout', 'mod.notes'])
  assert.deepEqual(m.find(e => e.label === 'mod.roles').submenu.map(e => [e.label, e.checked]), [['Membre', true], ['VIP', false]])
  assert.deepEqual(m.find(e => e.label === 'mod.moveToMenu').submenu.map(e => e.label), ['Jeu'])
  for (const k of ['mod.serverMute', 'mod.serverDeafen']) {
    const e = m.find(x => x.label === k)
    assert.equal(e.danger, true)
    assert.equal(e.checked, false)
  }
})

test('modération : actions transmises avec le bon état', () => {
  const calls = []
  const rec = new Proxy({}, { get: (_, k) => (...args) => calls.push([k, ...args]) })
  const m = buildModMenu(mod({ serverMuted: true }), rec, t)
  m.find(e => e.label === 'mod.serverMute').onClick()
  m.find(e => e.label === 'mod.roles').submenu[1].onClick()
  m.find(e => e.label === 'mod.moveToMenu').submenu[0].onClick()
  assert.deepEqual(calls, [['serverMute', false], ['role', 'r2', true], ['moveTo', 'v2']])
})

test('modération : rien sans droits, pas au-dessus, hors vocal, soi-même', () => {
  const none = { roles: false, mute: false, deafen: false, move: false, kick: false, ban: false, timeout: false, notes: false, channelPerms: false }
  assert.deepEqual(buildModMenu(mod({ can: none }), actions, t), [])
  // Pas au-dessus : seulement les notes (et les permissions du salon, qui ne dépendent pas du rang).
  assert.deepEqual(labels(buildModMenu(mod({ above: false }), actions, t)), ['---', 'mod.channelPerms', 'mod.notes'])
  // Hors vocal : ni déplacer, ni déconnecter, ni permissions du salon.
  const out = labels(buildModMenu(mod({ currentVoice: null }), actions, t))
  for (const k of ['mod.moveToMenu', 'mod.disconnect', 'mod.channelPerms']) assert.ok(!out.includes(k), k)
  // Soi-même : rôles et vocal, jamais expulser / bannir / timeout / notes.
  const self = labels(buildModMenu(mod({ self: true, above: false }), actions, t))
  assert.ok(self.includes('mod.roles') && self.includes('mod.serverMute'))
  for (const k of ['mod.kickName:alice', 'mod.banName:alice', 'mod.timeout', 'mod.notes']) assert.ok(!self.includes(k), k)
  assert.ok(labels(buildModMenu(mod({ timedOut: true }), actions, t)).includes('mod.liftTimeout'))
  assert.ok(!labels(buildModMenu(mod({ roles: [] }), actions, t)).includes('mod.roles'))
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
