import { defaultEventFields, parseLocalDateTime } from '@/features/servers/events'
import { overrideState, setOverrideState } from '@/features/servers/overrides'
import { PERM } from '@/features/servers/perms'
import { moveItem, reorderChannelIds, reorderRoleIds } from '@/features/servers/reorder'
import type { Category, Channel, Role } from '@/types/models'

describe('surcharges de permissions par salon', () => {
  it('un bit est autorisé, refusé ou hérité, jamais les deux', () => {
    let o = { allow: 0, deny: 0 }
    o = setOverrideState(o, PERM.SEND_MESSAGES, 'deny')
    expect(overrideState(o, PERM.SEND_MESSAGES)).toBe('deny')
    o = setOverrideState(o, PERM.SEND_MESSAGES, 'allow')
    expect(o).toEqual({ allow: PERM.SEND_MESSAGES, deny: 0 })
    o = setOverrideState(o, PERM.SEND_MESSAGES, 'inherit')
    expect(o).toEqual({ allow: 0, deny: 0 })
    expect(overrideState(o, PERM.SEND_MESSAGES)).toBe('inherit')
  })

  it('garde les autres bits et STREAM (bit 40, au-delà des 32 bits)', () => {
    let o = { allow: PERM.VIEW_CHANNEL, deny: PERM.ATTACH_FILES }
    o = setOverrideState(o, PERM.STREAM, 'deny')
    expect(o.deny).toBe(PERM.ATTACH_FILES + PERM.STREAM)
    expect(overrideState(o, PERM.STREAM)).toBe('deny')
    expect(overrideState(o, PERM.VIEW_CHANNEL)).toBe('allow')
    o = setOverrideState(o, PERM.STREAM, 'allow')
    expect(o).toEqual({ allow: PERM.VIEW_CHANNEL + PERM.STREAM, deny: PERM.ATTACH_FILES })
  })
})

const ch = (id: string, position: number, category_id: string | null = null, extra: Partial<Channel> = {}): Channel => ({
  id,
  server_id: 's',
  category_id,
  name: id,
  type: 'text',
  topic: null,
  position,
  is_nsfw: false,
  slowmode_delay: 0,
  user_limit: null,
  ...extra,
})
const cat = (id: string, position: number): Category => ({ id, server_id: 's', name: id, position })
const role = (id: string, position: number, is_everyone = false): Role => ({
  id,
  server_id: 's',
  name: id,
  color: 0,
  permissions: 0,
  position,
  mentionable: false,
  hoisted: false,
  is_everyone,
})

describe('réordonnancement', () => {
  it('moveItem échange avec le voisin, refuse de sortir de la liste', () => {
    expect(moveItem(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c'])
    expect(moveItem(['a', 'b', 'c'], 2, 1)).toBeNull()
    expect(moveItem(['a'], 0, -1)).toBeNull()
  })

  it('salons : déplacement dans sa catégorie, ordre complet renvoyé (masqués et archivés compris)', () => {
    const channels = [ch('libre', 0), ch('a', 1, 'k'), ch('b', 2, 'k', { archived: true }), ch('c', 3, 'k', { hidden: true }), ch('x', 4, 'k2')]
    const cats = [cat('k', 0), cat('k2', 1)]
    expect(reorderChannelIds(channels, cats, 'c', -1)).toEqual(['libre', 'a', 'c', 'b', 'x'])
    // Pas de saut de catégorie : premier de sa catégorie, il ne monte pas.
    expect(reorderChannelIds(channels, cats, 'a', -1)).toBeNull()
    expect(reorderChannelIds(channels, cats, 'x', 1)).toBeNull()
    expect(reorderChannelIds(channels, cats, 'inconnu', 1)).toBeNull()
  })

  it('rôles : du plus haut au plus bas sans @everyone, jamais au-dessus d’un rôle intouchable', () => {
    const roles = [role('everyone', 0, true), role('bas', 1), role('milieu', 2), role('haut', 3)]
    const below = (r: Role) => r.position < 3 // mon rôle le plus haut est « haut »
    expect(reorderRoleIds(roles, 'bas', -1, below)).toEqual(['haut', 'bas', 'milieu'])
    expect(reorderRoleIds(roles, 'milieu', -1, below)).toBeNull()
    expect(reorderRoleIds(roles, 'bas', 1, below)).toBeNull()
    expect(reorderRoleIds(roles, 'haut', 1, () => true)).toEqual(['milieu', 'haut', 'bas'])
  })
})

describe('événements : saisie de la date', () => {
  it('accepte JJ/MM/AAAA et HH:MM (ou 9h05), refuse les dates impossibles', () => {
    expect(parseLocalDateTime('05/11/2026', '20:30')).toEqual(new Date(2026, 10, 5, 20, 30))
    expect(parseLocalDateTime(' 5/11/2026 ', '9h05')).toEqual(new Date(2026, 10, 5, 9, 5))
    expect(parseLocalDateTime('31/02/2026', '10:00')).toBeNull()
    expect(parseLocalDateTime('01/01/2026', '24:00')).toBeNull()
    expect(parseLocalDateTime('2026-01-01', '10:00')).toBeNull()
  })

  it('par défaut : demain à 20 h, relisible', () => {
    const f = defaultEventFields(new Date(2026, 11, 31, 15, 0))
    expect(f).toEqual({ day: '01/01/2027', time: '20:00' })
    expect(parseLocalDateTime(f.day, f.time)).toEqual(new Date(2027, 0, 1, 20, 0))
  })
})
