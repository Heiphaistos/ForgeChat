import { railEntries } from '@/features/servers/layout'
import type { Server } from '@/types/models'

const s = (id: string) => ({ id, name: id }) as unknown as Server
const servers = [s('a'), s('b'), s('c'), s('d')]

test('sans disposition : liste inchangée', () => {
  expect(railEntries(servers, null).map((e) => (e.kind === 'server' ? e.server.id : e.id))).toEqual(['a', 'b', 'c', 'd'])
})

test('ordre du web, dossiers après les serveurs libres, serveurs inconnus ignorés', () => {
  const out = railEntries(servers, {
    order: ['c', 'a'],
    folders: { f1: { name: 'Jeux', color: '#ff0000', serverIds: ['b', 'zz'] }, vide: { name: 'Vide', serverIds: ['zz'] } },
  })
  expect(out.map((e) => (e.kind === 'server' ? e.server.id : `${e.id}:${e.servers.map((x) => x.id).join(',')}`))).toEqual(['c', 'a', 'd', 'f1:b'])
})

test('disposition abîmée : pas de plantage, couleur et nom par défaut', () => {
  const out = railEntries(servers, { order: 'x', folders: { f: { name: '', color: 'red', serverIds: ['a'] }, g: null } })
  const f = out.find((e) => e.kind === 'folder')
  expect(f && f.kind === 'folder' && [f.name, f.color]).toEqual(['Dossier', '#5865F2'])
})
