import { discordSyncApi } from '@/api/discordSync'
import {
  buildPutBody,
  canManageDiscordSync,
  canSave,
  canUnlinkDiscordSync,
  formFromConfig,
  isGuildId,
  normalizeConfig,
  syncError,
} from '@/features/servers/discordSync'
import {
  categoryState,
  counts,
  filterTree,
  flattenTree,
  initialSelection,
  invertSelection,
  selectAll,
  selectNone,
  toPayload,
  toggleCategory,
  toggleChannel,
  type SyncTree,
} from '@/features/servers/discordSyncTree'
import { PERM, serverPerms, settingsSections } from '@/features/servers/perms'
import { ApiError, http } from '@/lib/http'
import type { Role, ServerDetail } from '@/types/models'

jest.mock('@/lib/http', () => ({
  ...jest.requireActual('@/lib/http'),
  http: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}))

const S = '3af17b11-1c9a-4daf-8895-a2d3eec03894'
const ch = (id: string, name: string, selected = true) => ({ id, name, kind: 'text' as const, selected })
const tree: SyncTree = {
  categories: [
    { id: 'c1', name: 'Général', selected: true, channels: [ch('a', 'accueil'), ch('b', 'règles', false)] },
    { id: 'c2', name: 'Vocal', selected: false, channels: [ch('v', 'salon-vocal', false)] },
    { id: 'c3', name: 'Vide', selected: true, channels: [] },
  ],
  uncategorized: [ch('u', 'hors-catégorie')],
}

describe('arbre : sélection', () => {
  it('sélection initiale et états de catégorie (partiel)', () => {
    const sel = initialSelection(tree)
    expect([...sel].sort()).toEqual(['a', 'c1', 'c3', 'u'])
    expect(categoryState(tree.categories[0]!, sel)).toBe('some')
    expect(categoryState(tree.categories[1]!, sel)).toBe('none')
    expect(categoryState(tree.categories[2]!, sel)).toBe('all')
  })
  it('bascule catégorie et salon (la catégorie suit ses salons)', () => {
    const on = toggleCategory(tree.categories[1]!, new Set(), true)
    expect([...on].sort()).toEqual(['c2', 'v'])
    expect(toggleCategory(tree.categories[1]!, on, false).size).toBe(0)
    const s1 = toggleChannel(tree.categories[1]!, 'v', new Set(), true)
    expect(s1.has('c2')).toBe(true)
    expect(toggleChannel(tree.categories[1]!, 'v', s1, false).has('c2')).toBe(false)
    expect(toggleChannel(null, 'u', new Set(), true).has('u')).toBe(true)
  })
  it('tout / rien / inverser / compteur', () => {
    expect(counts(tree, selectAll(tree))).toEqual({ selected: 7, total: 7 })
    expect(selectNone().size).toBe(0)
    expect(counts(tree, initialSelection(tree))).toEqual({ selected: 4, total: 7 })
    expect([...invertSelection(tree, initialSelection(tree))].sort()).toEqual(['b', 'c1', 'c2', 'v'])
  })
  it('charge utile : chaque élément coché ou décoché', () => {
    const p = toPayload(tree, initialSelection(tree))
    expect(p.included_ids.sort()).toEqual(['a', 'c1', 'c3', 'u'])
    expect(p.excluded_ids.sort()).toEqual(['b', 'c2', 'v'])
  })
  it('filtre sans accents : catégorie trouvée garde ses salons, sinon seuls les salons trouvés', () => {
    expect(filterTree(tree, '').categories).toHaveLength(3)
    const f = filterTree(tree, 'GENERAL')
    expect(f.categories.map((c) => c.id)).toEqual(['c1'])
    expect(f.categories[0]!.channels).toHaveLength(2)
    const g = filterTree(tree, 'regles')
    expect(g.categories[0]!.channels.map((c) => c.id)).toEqual(['b'])
    expect(g.uncategorized).toEqual([])
    expect(filterTree(tree, 'zzz')).toEqual({ categories: [], uncategorized: [] })
  })
  it('aplatissement : catégories repliées omises sauf en recherche', () => {
    expect(flattenTree(tree, new Set(), false).map((r) => r.type)).toEqual(['category', 'channel', 'channel', 'category', 'channel', 'category', 'channel'])
    expect(flattenTree(tree, new Set(['c1']), false)).toHaveLength(5)
    expect(flattenTree(tree, new Set(['c1']), true)).toHaveLength(7)
  })
})

describe('config et corps des requêtes', () => {
  const raw = {
    configured: true,
    guild_id: '123456789012345678',
    has_token: true,
    interval_hours: 48,
    excluded_categories: ['news', 3],
    enabled: true,
    sync_emojis: false,
    sync_mode: 'content',
    auto_include_new: false,
    last_status: 'partial',
    last_imported: 12,
    running: false,
    guild_name: 'G',
  }
  it('normalise la réponse du serveur, valeurs invalides ramenées aux défauts', () => {
    expect(normalizeConfig(raw)).toMatchObject({
      intervalHours: 48,
      excludedCategories: ['news'],
      syncMode: 'content',
      syncEmojis: false,
      autoIncludeNew: false,
      lastStatus: 'partial',
      hasToken: true,
    })
    expect(normalizeConfig(null)).toMatchObject({ configured: false, intervalHours: 24, syncMode: 'full', syncEmojis: true, autoIncludeNew: true })
    expect(normalizeConfig({ interval_hours: 7, sync_mode: 'x', last_status: 'zz' })).toMatchObject({ intervalHours: 24, syncMode: 'full', lastStatus: null })
  })
  it('identifiant Discord et droit d’enregistrer', () => {
    expect(isGuildId(' 123456789012345678 ')).toBe(true)
    expect(isGuildId('12345')).toBe(false)
    expect(isGuildId('12345678901234a')).toBe(false)
    const f = { ...formFromConfig(normalizeConfig({ guild_id: '123456789012345678' })), enabled: true }
    expect(canSave(f, false)).toBe(false)
    expect(canSave({ ...f, token: ' x ' }, false)).toBe(true)
    expect(canSave(f, true)).toBe(true)
    expect(canSave({ ...f, guildId: 'abc' }, true)).toBe(false)
  })
  it('PUT : jeton absent si vide, sélection seulement si l’arbre est chargé', () => {
    const f = { ...formFromConfig(normalizeConfig(raw)), guildId: ' 123456789012345678 ' }
    const a = buildPutBody(f, ['news'], null, new Set())
    expect(a).toEqual({
      guild_id: '123456789012345678',
      interval_hours: 48,
      excluded_categories: ['news'],
      enabled: true,
      sync_emojis: false,
      sync_mode: 'content',
      auto_include_new: false,
    })
    expect('bot_token' in a).toBe(false)
    const b = buildPutBody({ ...f, token: '  tok  ' }, [], tree, initialSelection(tree))
    expect(b).toMatchObject({ bot_token: 'tok', included_ids: expect.any(Array), excluded_ids: expect.any(Array) })
  })
  it('routes de l’API', async () => {
    ;(http.get as jest.Mock).mockResolvedValue(raw)
    ;(http.put as jest.Mock).mockResolvedValue(raw)
    expect((await discordSyncApi.get(S)).guildName).toBe('G')
    expect(http.get).toHaveBeenCalledWith(`/servers/${S}/discord-sync`)
    await discordSyncApi.put(S, { a: 1 })
    expect(http.put).toHaveBeenCalledWith(`/servers/${S}/discord-sync`, { a: 1 })
    await discordSyncApi.run(S)
    expect(http.post).toHaveBeenCalledWith(`/servers/${S}/discord-sync/run`)
    await discordSyncApi.tree(S)
    expect(http.get).toHaveBeenCalledWith(`/servers/${S}/discord-sync/tree`)
    await discordSyncApi.remove(S)
    expect(http.delete).toHaveBeenCalledWith(`/servers/${S}/discord-sync`)
  })
  it('429 : message du serveur, ou repli traduit', () => {
    expect(syncError(new ApiError(429, 'Synchronisation déjà lancée il y a moins de 5 minutes.', 'rate_limited'))).toContain('5 minutes')
    expect(syncError(new ApiError(429, ''))).toMatch(/\S/)
    expect(syncError(new Error('boom'))).toBe('boom')
  })
})

describe('droits', () => {
  const role = (permissions: number): Role => ({ id: 'r', server_id: 's', name: 'r', color: 0, permissions, position: 1, is_everyone: false }) as Role
  const detail = (permissions: number): ServerDetail =>
    ({ server: { id: 's', owner_id: 'o' }, roles: [role(permissions)], my_role_ids: ['r'], channels: [], categories: [] }) as unknown as ServerDetail
  it('MANAGE_SERVER voit la rubrique, un simple modérateur non', () => {
    expect(settingsSections(serverPerms(detail(PERM.MANAGE_SERVER), 'me'))).toContain('discordSync')
    expect(settingsSections(serverPerms(detail(PERM.KICK_MEMBERS), 'me'))).not.toContain('discordSync')
    expect(settingsSections(serverPerms(undefined, 'me'))).not.toContain('discordSync')
  })
  it('délier = propriétaire seulement', () => {
    const admin = serverPerms(detail(PERM.MANAGE_SERVER), 'me')
    expect(canManageDiscordSync(admin)).toBe(true)
    expect(canUnlinkDiscordSync(admin)).toBe(false)
    expect(canUnlinkDiscordSync(serverPerms(detail(0), 'o'))).toBe(true)
    expect(canManageDiscordSync(serverPerms(detail(PERM.KICK_MEMBERS), 'me'))).toBe(false)
  })
})
