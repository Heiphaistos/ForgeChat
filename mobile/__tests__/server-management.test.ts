import { serversApi } from '@/api/servers'
import { channelSections, pickChannel, rememberChannel } from '@/features/servers/channels'
import { deleteServerBody, deleteServerError, deleteServerFailure } from '@/features/servers/deleteServer'
import { PERM, hasBit, memberActions, roleColorHex, serverMenuKeys, serverPerms, settingsSections, toggleBit } from '@/features/servers/perms'
import { ApiError } from '@/lib/http'
import type { Category, Channel, Role, ServerDetail } from '@/types/models'

const OWNER = 'owner'
const ME = 'me'

const role = (id: string, permissions: number, position: number, is_everyone = false): Role => ({
  id,
  server_id: 's',
  name: id,
  color: 0,
  permissions,
  position,
  mentionable: false,
  hoisted: false,
  is_everyone,
})

// Addition, pas `|` : l'opérateur bit à bit de JS tronquerait STREAM (bit 40).
const BASE = PERM.VIEW_CHANNEL + PERM.SEND_MESSAGES + PERM.STREAM
const detail = (myRoles: string[], roles: Role[] = []): ServerDetail => ({
  server: { id: 's', name: 'Serveur', icon: null, banner: null, description: null, owner_id: OWNER, member_count: 3, is_public: false, system_channel_id: null, rules_channel_id: null },
  channels: [],
  roles: [role('everyone', BASE, 0, true), ...roles],
  current_user_id: ME,
  my_role_ids: myRoles,
})

describe('permissions affichées', () => {
  it('simple membre : pas de paramètres, peut quitter, jamais supprimer', () => {
    const p = serverPerms(detail([]), ME)
    expect(serverMenuKeys(p)).toEqual(['read', 'notifications', 'events', 'community', 'nickname', 'boost', 'copyId', 'leave'])
    expect(settingsSections(p)).toEqual([])
  })

  it('propriétaire : tout, supprimer au lieu de quitter', () => {
    const p = serverPerms(detail([]), OWNER)
    expect(serverMenuKeys(p)).toEqual(['read', 'invite', 'notifications', 'events', 'community', 'createChannel', 'createCategory', 'settings', 'nickname', 'boost', 'copyId', 'delete'])
    expect(settingsSections(p)).toEqual(['overview', 'advanced', 'channels', 'roles', 'tags', 'members', 'reports', 'bans', 'invites', 'emojis', 'webhooks', 'audit', 'automod', 'stats', 'community', 'onboarding', 'danger'])
  })

  it('questions d’accueil : chaque membre peut revoir ses réponses', () => {
    const p = serverPerms({ ...detail([]), member: { verified_at: null, has_onboarding: true } }, ME)
    expect(serverMenuKeys(p)).toEqual(['read', 'notifications', 'events', 'community', 'nickname', 'onboarding', 'boost', 'copyId', 'leave'])
  })

  it('administrateur (bit 31) : tout sauf vue d’ensemble et zone de danger (réservées au propriétaire)', () => {
    const p = serverPerms(detail(['admin'], [role('admin', PERM.ADMINISTRATOR, 1)]), ME)
    expect(p.isAdmin).toBe(true)
    expect(settingsSections(p)).toEqual(['channels', 'roles', 'tags', 'members', 'reports', 'bans', 'invites', 'emojis', 'webhooks', 'audit', 'automod', 'stats', 'community'])
    expect(serverMenuKeys(p)).toContain('leave')
    expect(serverMenuKeys(p)).not.toContain('delete')
  })

  it('droits isolés : créer des salons sans gérer le serveur', () => {
    const p = serverPerms(detail(['c'], [role('c', PERM.CREATE_CHANNELS, 1)]), ME)
    expect(serverMenuKeys(p)).toEqual(['read', 'notifications', 'events', 'community', 'createChannel', 'createCategory', 'nickname', 'boost', 'copyId', 'leave'])
    const bans = serverPerms(detail(['b'], [role('b', PERM.BAN_TEMP, 1)]), ME)
    expect(settingsSections(bans)).toEqual(['members', 'reports', 'bans'])
    const voice = serverPerms(detail(['v'], [role('v', PERM.MOVE_MEMBERS, 1)]), ME)
    expect(settingsSections(voice)).toEqual(['members'])
  })

  it('un rôle non attribué ne compte pas ; tant que rien n’est chargé, ni quitter ni supprimer', () => {
    const p = serverPerms(detail([], [role('admin', PERM.ADMINISTRATOR, 1)]), ME)
    expect(p.isAdmin).toBe(false)
    expect(serverMenuKeys(serverPerms(undefined, ME))).toEqual(['read', 'notifications', 'nickname', 'copyId'])
  })

  it('suppression de salon : règle deletion_refusal du serveur', () => {
    const own = serverPerms(detail(['o'], [role('o', PERM.DELETE_OWN_CHANNELS, 1)]), ME)
    expect(own.canDeleteChannel(ME)).toBe(true)
    expect(own.canDeleteChannel('autre')).toBe(false)
    const all = serverPerms(detail(['d'], [role('d', PERM.DELETE_CHANNELS, 1)]), ME)
    expect(all.canDeleteChannel('autre')).toBe(true)
    expect(all.canDeleteChannel(OWNER)).toBe(false) // salon du propriétaire protégé
    expect(serverPerms(detail([]), OWNER).canDeleteChannel(OWNER)).toBe(true)
  })

  it('hiérarchie : on ne modère que sous son rôle le plus haut, jamais le propriétaire', () => {
    const roles = [role('mod', PERM.KICK_MEMBERS | PERM.MANAGE_ROLES, 2), role('vip', 0, 3), role('low', 0, 1)]
    const p = serverPerms(detail(['mod'], roles), ME)
    expect(memberActions(p, { user_id: 'x', role_ids: ['low'] })).toMatchObject({ kick: true, roles: true, ban: false, timeout: false })
    expect(memberActions(p, { user_id: 'x', role_ids: ['vip'] }).kick).toBe(false)
    expect(memberActions(p, { user_id: OWNER, is_owner: true }).kick).toBe(false)
    expect(memberActions(p, { user_id: ME, role_ids: ['mod'] })).toMatchObject({ kick: false, roles: true })
    expect(p.roleBelow(roles[2]!)).toBe(true)
    expect(p.roleBelow(roles[0]!)).toBe(false) // son propre rôle
  })

  it('bits au-delà de 32 bits (STREAM = 2^40) conservés', () => {
    expect(hasBit(BASE, PERM.STREAM)).toBe(true)
    expect(toggleBit(BASE, PERM.STREAM)).toBe(PERM.VIEW_CHANNEL | PERM.SEND_MESSAGES)
    expect(toggleBit(PERM.ADMINISTRATOR, PERM.STREAM)).toBe(2 ** 31 + 2 ** 40)
    expect(hasBit(2 ** 31 + 2 ** 40, PERM.ADMINISTRATOR)).toBe(true)
    expect(roleColorHex(0)).toBeNull()
    expect(roleColorHex(0x5865f2)).toBe('#5865f2')
  })
})

const ch = (id: string, position: number, extra: Partial<Channel> = {}): Channel => ({
  id,
  server_id: 's',
  category_id: null,
  name: id,
  type: 'text',
  topic: null,
  position,
  is_nsfw: false,
  slowmode_delay: 0,
  user_limit: null,
  ...extra,
})

describe('dernier salon consulté', () => {
  const cats: Category[] = [{ id: 'k2', server_id: 's', name: 'B', position: 2 }, { id: 'k1', server_id: 's', name: 'A', position: 1 }]
  const channels = [
    ch('voice', 0, { type: 'voice' }),
    ch('inK2', 0, { category_id: 'k2' }),
    ch('inK1', 5, { category_id: 'k1' }),
    ch('archived', 1, { archived: true }),
    ch('news', 3, { type: 'announcement', category_id: 'k2' }),
  ]

  it('rouvre le dernier salon s’il est encore lisible', () => {
    expect(pickChannel(channels, cats, 'news')?.id).toBe('news')
  })

  it('sinon le premier salon texte dans l’ordre affiché (catégories triées), ni vocal ni archivé', () => {
    expect(pickChannel(channels, cats, undefined)?.id).toBe('inK1')
    expect(pickChannel(channels, cats, 'archived')?.id).toBe('inK1')
    expect(pickChannel(channels, cats, 'voice')?.id).toBe('inK1')
    expect(pickChannel([ch('v', 0, { type: 'voice' })], [], undefined)).toBeNull()
  })

  it('sections : catégories vides gardées (menu de catégorie), dans l’ordre', () => {
    expect(channelSections([], cats).map((s) => s.title)).toEqual(['A', 'B'])
  })

  it('mémorise par serveur, le plus récent en dernier, et borne la taille', () => {
    let m = rememberChannel({}, 'a', '1')
    m = rememberChannel(m, 'b', '2')
    m = rememberChannel(m, 'a', '3')
    expect(m).toEqual({ b: '2', a: '3' })
    expect(Object.keys(m)).toEqual(['b', 'a'])
    expect(Object.keys(rememberChannel(m, 'c', '4', 2))).toEqual(['a', 'c'])
  })
})

describe('suppression du serveur', () => {
  it('corps : code 2FA seulement s’il est saisi, espaces retirés', () => {
    expect(deleteServerBody('pw', '')).toEqual({ password: 'pw' })
    expect(deleteServerBody('pw', ' 123 456 ')).toEqual({ password: 'pw', totp_code: '123456' })
  })

  it('confirmation : nom (casse et espaces tolérés), mot de passe, code si requis', () => {
    expect(deleteServerError('autre', 'Mon Serveur', 'pw', false, '')).toMatch(/nom/)
    expect(deleteServerError(' mon serveur ', 'Mon Serveur', '', false, '')).toMatch(/mot de passe/)
    expect(deleteServerError('Mon Serveur', 'Mon Serveur', 'pw', true, ' ')).toMatch(/double authentification/)
    expect(deleteServerError('Mon Serveur', 'Mon Serveur', 'pw', false, '')).toBeNull()
  })

  it('403 totp_required : demande le code', () => {
    const f = deleteServerFailure(new ApiError(403, 'totp_required', 'totp_required'))
    expect(f).toMatchObject({ field: 'totp', needTotp: true })
  })

  it('erreurs du serveur au bon endroit', () => {
    expect(deleteServerFailure(new ApiError(400, 'Mot de passe incorrect'))).toEqual({ field: 'password', message: 'Mot de passe incorrect' })
    expect(deleteServerFailure(new ApiError(400, 'Code de double authentification incorrect'))).toMatchObject({ field: 'totp', needTotp: true })
    expect(deleteServerFailure(new ApiError(429, 'Too many', 'rate_limited')).message).toMatch(/15 minutes/)
    expect(deleteServerFailure(new ApiError(403, 'Accès interdit')).message).toMatch(/propriétaire/)
    expect(deleteServerFailure(new ApiError(500, 'Erreur serveur')).message).not.toMatch(/Erreur serveur/)
    expect(deleteServerFailure(new Error('x')).field).toBe('form')
  })
})

jest.mock('@/lib/tokens', () => ({
  tokens: { getAccessToken: () => 'jeton', accessTokenExpiresSoon: () => false, setAccessToken: jest.fn(), getUserId: async () => null },
}))

describe('DELETE /servers/:id via le client HTTP', () => {
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
  })

  it('envoie le corps JSON sur DELETE et remonte totp_required', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    global.fetch = jest.fn(async (url: string, init: RequestInit) => {
      // Connexion v2 : sel du compte d'abord ; compte pas encore migré = le mot de passe sert de preuve.
      if (url.endsWith('/users/me/kdf')) return new Response(JSON.stringify({ kdf_salt: null, legacy: true }), { status: 200 })
      calls.push({ url, init })
      return new Response(JSON.stringify({ error: 'totp_required' }), { status: 403 })
    }) as unknown as typeof fetch
    const err = await serversApi.remove('a0000000-0000-4000-8000-000000000001', deleteServerBody('pw', '123456')).catch((e: unknown) => e)
    expect(calls[0]!.url).toMatch(/\/servers\/a0000000-0000-4000-8000-000000000001$/)
    expect(calls[0]!.init.method).toBe('DELETE')
    expect((calls[0]!.init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ password: 'pw', totp_code: '123456' })
    expect(err).toBeInstanceOf(ApiError)
    expect(deleteServerFailure(err)).toMatchObject({ field: 'totp', needTotp: true })
  })
})
