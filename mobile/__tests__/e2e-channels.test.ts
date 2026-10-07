// Salons chiffrés : fonctions pures de e2e/channels et de serverKey, champs de
// chiffrement lus par les adaptateurs (fils, forums, sondages, messages).
jest.mock('expo-crypto', () => ({ randomUUID: () => '11111111-1111-4111-8111-111111111111', getRandomBytes: (n: number) => new Uint8Array(n) }))
jest.mock('@/lib/http', () => ({
  ApiError: class ApiError extends Error {},
  http: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
  path: (s: TemplateStringsArray, ...v: unknown[]) => s.reduce((acc, p, i) => acc + p + (i < v.length ? String(v[i]) : ''), ''),
}))
jest.mock('@/e2e/accountKey', () => ({ useAccountKey: { getState: () => ({ status: 'ready', priv: null, userId: null }) } }))
jest.mock('@/i18n', () => ({ t: (k: string) => k }))

import { applyPollBody, encryptedPollBody, isBotCommand, pushRecent } from '@/e2e/channels'
import { recoveredAsText } from '@/e2e/serverKey'
import { fromServerMessage, fromThreadMessage } from '@/features/chat/adapters'
import { savedBody } from '@/features/chat/messageExtras'
import { normalizeThreads } from '@/features/chat/threads'
import { normalizePost } from '@/features/forum/forum'
import type { ChatMessage, ServerMessage } from '@/types/models'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const enc = { v: 1 as const, epoch: 0, iv: 'x', ct: 'y' }

describe('commandes de bot (envoyées en clair)', () => {
  it('commande connue seule ou avec arguments ; inconnue ou texte ordinaire : non', () => {
    expect(isBotCommand('/meteo', ['meteo'])).toBe(true)
    expect(isBotCommand('/Meteo Paris', ['meteo'])).toBe(true)
    expect(isBotCommand('/meteorite', ['meteo'])).toBe(false)
    expect(isBotCommand('/shrug', ['meteo'])).toBe(false)
    expect(isBotCommand('salut /meteo', ['meteo'])).toBe(false)
  })
})

describe('anti-spam : mes derniers envois', () => {
  it('garde les 10 plus récents, dans l’ordre', () => {
    let list = pushRecent([], 'a', 1)
    for (let i = 0; i < 12; i++) list = pushRecent(list, `m${i}`, 2 + i)
    expect(list).toHaveLength(10)
    expect(list[0]).toEqual({ text: 'm2', at: 4 })
    expect(list[9]).toEqual({ text: 'm11', at: 13 })
  })
})

describe('sondages chiffrés', () => {
  it('corps envoyé : question et options vides, autant que d’options', () => {
    const body = encryptedPollBody({ question: 'Pizza ?', options: ['Oui', 'Non', 'Bof'], multiple_choice: false }, { enc, client_msg_id: A })
    expect(body).toEqual({ question: '', options: ['', '', ''], multiple_choice: false, enc, client_msg_id: A })
  })
  it('affichage : options dans l’ordre de position ↔ o[i] ; contenu illisible : texte d’attente', () => {
    const raw = { id: B, question: '', options: [{ id: 'o2', text: '', position: 1 }, { id: 'o1', text: '', position: 0 }] }
    const open = applyPollBody(raw, { t: 'Pizza ?', o: ['Oui', 'Non'] })
    expect(open.question).toBe('Pizza ?')
    expect(open.options).toEqual([{ id: 'o1', text: 'Oui', position: 0 }, { id: 'o2', text: 'Non', position: 1 }])
    expect(applyPollBody(raw, null).question).toBe('e2e.msg.locked')
  })
})

describe('récupération du serveur : export texte', () => {
  it('un bloc par salon, message illisible signalé', () => {
    const text = recoveredAsText([
      { channel_id: A, name: 'général', messages: [
        { id: '1', author: 'bob', created_at: '2026-10-07T10:00:00Z', text: 'salut', encrypted: true },
        { id: '2', author: 'eve', created_at: '2026-10-07T10:01:00Z', text: null, encrypted: true },
      ] },
      { channel_id: B, name: 'vide', messages: [] },
    ], '[illisible]')
    expect(text).toBe('# général\n[2026-10-07T10:00:00Z] bob: salut\n[2026-10-07T10:01:00Z] eve: [illisible]\n\n# vide')
  })
})

describe('champs de chiffrement lus par les adaptateurs', () => {
  const server = (extra: Partial<ServerMessage>): ServerMessage => ({
    id: A, channel_id: B, content: 'voir https://ex.test/a', type: 'default', reply_to: null, reply_to_content: null, reply_to_username: null,
    pinned: false, edited_at: null, created_at: '2026-10-07T10:00:00Z', author_id: B, author_username: 'bob', author_discriminator: '0001',
    author_avatar: null, author_is_bot: false, attachments: [], reactions: [], ...extra,
  })
  it('message de salon chiffré : aperçu de l’expéditeur, id client ; message en clair : badge', () => {
    const m = fromServerMessage(server({ e2e: 'ok', client_msg_id: A, e2e_body: { t: 'x', p: { title: 'Titre', url: 'https://ex.test/a' } } }))
    expect(m).toMatchObject({ e2e: 'ok', clientMsgId: A, preview: { title: 'Titre', url: 'https://ex.test/a' } })
    expect(m.unencrypted).toBeUndefined()
    const plain = fromServerMessage(server({ unencrypted: true }))
    expect(plain.unencrypted).toBe(true)
    expect(plain.preview).toBeUndefined()
  })
  it('message de fil chiffré : état et id client conservés', () => {
    expect(fromThreadMessage({ id: A, created_at: '2026-10-07T10:00:00Z', user_id: B, content: 'x', client_msg_id: B, e2e: 'locked' }))
      .toMatchObject({ e2e: 'locked', clientMsgId: B, authorId: B })
  })
  it('fil : id client (portée) et titre chiffré ; publication : id client et état', () => {
    const [th] = normalizeThreads([{ id: A, title: 'Titre', client_id: B.toUpperCase(), title_encrypted: true }])
    expect(th).toMatchObject({ clientId: B, titleEncrypted: true })
    expect(normalizeThreads([{ id: A, title: 'x' }])[0]).toMatchObject({ clientId: null, titleEncrypted: false })
    const post = normalizePost({ id: A, title: 'T', created_at: '2026-10-07T10:00:00Z', client_msg_id: B, e2e: 'ok' })
    expect(post).toMatchObject({ clientMsgId: B, e2e: 'ok' })
  })
  it('enregistrer un message chiffré n’envoie pas son texte au serveur', () => {
    const msg = { id: A, content: 'secret', authorName: 'bob', authorAvatar: null, e2e: 'ok' } as ChatMessage
    expect(savedBody({ kind: 'channel', serverId: B, channelId: A }, msg).content).toBeNull()
    expect(savedBody({ kind: 'channel', serverId: B, channelId: A }, { ...msg, e2e: undefined }).content).toBe('secret')
  })
})
