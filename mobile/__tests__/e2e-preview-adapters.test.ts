// Aperçu de lien chiffré (`p`) : lu pour les MP et groupes, pas seulement les salons.
import { fromDmMessage, fromGroupMessage } from '@/features/chat/adapters'

const base = {
  id: 'm1', content: 'voir https://github.com', created_at: '2026-10-15T00:00:00Z', sender_id: 'u1', sender_username: 'a',
  e2e: 'ok', e2e_body: { t: 'voir https://github.com', p: { title: 'GitHub', description: 'Code' } },
}

test.each([['MP', fromDmMessage], ['groupe', fromGroupMessage]] as const)('%s : aperçu chiffré affiché', (_, adapt) => {
  const m = adapt(base as never)
  expect(m.preview).toMatchObject({ title: 'GitHub', url: 'https://github.com' })
})

test('MP chiffré sans aperçu : null (pas d appel à /og)', () => {
  expect(fromDmMessage({ ...base, e2e_body: { t: 'x' } } as never).preview).toBeNull()
})
