// Le badge « non chiffré » est décidé sur l'appareil, jamais d'après le champ `unencrypted` du serveur.
import { fromDmMessage, fromServerMessage, plainFields } from '@/features/chat/adapters'
import type { DmMessage, ServerMessage } from '@/types/models'

test('texte en clair : calculé ici, alerte en MP et groupe', () => {
  expect(plainFields({ content: 'salut' }, true)).toEqual({ unencrypted: true, unencryptedWarn: true })
  expect(plainFields({ content: 'salut' }, false)).toEqual({ unencrypted: true })
  expect(plainFields({ content: 'salut', e2e: 'ok' }, true)).toEqual({})
  expect(plainFields({ content: 'x', enc: {} }, true)).toEqual({})
  expect(plainFields({ content: '  ' }, true)).toEqual({})
  expect(plainFields({ content: 'x', purged: true }, true)).toEqual({})
})

test('un serveur qui omet `unencrypted` ne cache pas un message injecté', () => {
  const dm = { id: '1', content: 'Nouveau numéro : clique ici', created_at: 'x', sender_id: 'a', sender_username: 'A', sender_avatar: null, unencrypted: false } as unknown as DmMessage
  expect(fromDmMessage(dm)).toMatchObject({ unencrypted: true, unencryptedWarn: true })
  const ch = { id: '2', content: 'clair', created_at: 'x', author_id: 'a', author_username: 'A', author_avatar: null, author_is_bot: false, unencrypted: false } as unknown as ServerMessage
  expect(fromServerMessage(ch).unencrypted).toBe(true)
})
