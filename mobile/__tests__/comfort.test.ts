// Lot « confort et sécurité » (mobile) : hors ligne (cache chiffré, file d'envoi), plusieurs
// comptes (jetons rangés dans le Keystore), texte des widgets Android.
const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'x',
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockStore.delete(k)),
}))

import { forgetAccount, listAccounts, MAX_OTHER_ACCOUNTS, putAccount, takeAccount } from '@/lib/accounts'
import { cacheKey, convOf, isQueueable, seal, unseal } from '@/lib/offline'
import { buildWidgetText } from '@/services/widgets'

const U = '11111111-1111-4111-8111-111111111111'
const V = '22222222-2222-4222-8222-222222222222'

describe('hors ligne', () => {
  it('lectures gardées : première page des conversations et clés seulement', () => {
    expect(cacheKey('GET', `/dms/${U}/messages`, { limit: 50, before: undefined })).toBe(`/dms/${U}/messages?limit=50`)
    expect(cacheKey('GET', `/servers/${U}/channels/${V}/messages`, { limit: 50 })).toBe(`/servers/${U}/channels/${V}/messages?limit=50`)
    expect(cacheKey('GET', '/dms')).toBe('/dms')
    expect(cacheKey('GET', `/e2e/conversations/dm/${U}/keys`)).toBe(`/e2e/conversations/dm/${U}/keys`)
    expect(cacheKey('GET', `/dms/${U}/messages`, { limit: 50, before: V })).toBeNull()
    expect(cacheKey('GET', '/users/me/keys')).toBeNull()
    expect(cacheKey('POST', '/dms')).toBeNull()
  })

  it("file d'envoi : jamais de clair, jamais de pièce jointe", () => {
    const enc = { v: 1, epoch: 0, iv: 'a', ct: 'b' }
    expect(isQueueable('POST', `/dms/${U}/messages`, { enc, client_msg_id: U })).toBe(true)
    expect(isQueueable('POST', `/dms/groups/${U}/messages`, { enc })).toBe(true)
    expect(isQueueable('POST', `/servers/${U}/channels/${V}/messages`, { enc, has_attachments: false })).toBe(true)
    expect(isQueueable('POST', `/dms/${U}/messages`, { content: 'en clair' })).toBe(false)
    expect(isQueueable('POST', `/dms/${U}/messages`, { enc, has_attachments: true })).toBe(false)
    expect(isQueueable('PATCH', `/dms/${U}/messages`, { enc })).toBe(false)
  })

  it('conversation visée par un envoi', () => {
    expect(convOf(`/dms/groups/${U}/messages`)).toEqual(['group', U])
    expect(convOf(`/dms/${U}/messages`)).toEqual(['dm', U])
    expect(convOf(`/servers/${U}/channels/${V}/messages`)).toEqual(['channel', V])
    expect(convOf('/users/me')).toBeNull()
  })

  it('stockage chiffré : rien en clair, altération refusée', () => {
    const key = new Uint8Array(32).fill(7)
    const data = seal(key, { k: '/dms', d: [{ username: 'alice-secrete' }] })
    expect(Buffer.from(data).toString('latin1')).not.toContain('alice-secrete')
    expect(unseal(key, data)).toEqual({ k: '/dms', d: [{ username: 'alice-secrete' }] })
    const bad = data.slice()
    bad[20] = (bad[20] ?? 0) ^ 1
    expect(() => unseal(key, bad)).toThrow()
    expect(() => unseal(new Uint8Array(32), data)).toThrow()
  })
})

describe('plusieurs comptes', () => {
  beforeEach(() => mockStore.clear())

  it('range, rend et oublie un compte avec son jeton', async () => {
    await putAccount({ id: U, username: 'alice', avatar: null }, 'jeton-alice')
    expect(await listAccounts()).toEqual([{ id: U, username: 'alice', avatar: null }])
    expect(await takeAccount(U)).toBe('jeton-alice')
    expect(await listAccounts()).toEqual([])
    expect(mockStore.has(`fc.alt_rt.${U}`)).toBe(false)
    await putAccount({ id: V, username: 'bob', avatar: null }, 'jeton-bob')
    await forgetAccount(V)
    expect(await takeAccount(V)).toBeNull()
  })

  it('jamais de jeton dans la liste, nombre borné, ids vérifiés', async () => {
    await putAccount({ id: U, username: 'alice', avatar: null }, 'jeton-alice')
    expect(mockStore.get('fc.alt_accounts.v1')).not.toContain('jeton')
    for (let i = 1; i < MAX_OTHER_ACCOUNTS; i++) {
      await putAccount({ id: `${U.slice(0, -1)}${String.fromCharCode(97 + i)}`, username: `u${i}`, avatar: null }, 't')
    }
    await expect(putAccount({ id: V, username: 'bob', avatar: null }, 't')).rejects.toThrow('TOO_MANY')
    await expect(putAccount({ id: '../x', username: 'x', avatar: null }, 't')).rejects.toThrow('BAD_ACCOUNT')
  })
})

describe('widgets', () => {
  const convs = [
    { name: 'alice', unread: 2, lastText: 'mon code est 1234' },
    { name: 'groupe', unread: 0, lastText: null },
  ]
  const rooms = [{ channel: 'général', members: ['bob', 'carol'] }, { channel: 'vide', members: [] }]

  it('contenu masqué par défaut : noms et non-lus seulement', () => {
    const w = buildWidgetText(convs, 3, rooms, false)
    expect(w.messagesBody).not.toContain('1234')
    expect(w.messagesBody).toContain('alice')
    expect(w.messagesBody.split('\n')).toHaveLength(3)
    expect(w.voiceBody).toBe('#général : bob, carol')
    expect(w.voiceTitle).toContain('2')
  })

  it('contenu affiché seulement quand il est permis', () => {
    expect(buildWidgetText(convs, 0, [], true).messagesBody).toContain('1234')
    expect(buildWidgetText([], 0, [], true).voiceBody.length).toBeGreaterThan(0)
  })
})

describe('widgets Android (modules/call-service)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require('fs') as typeof import('fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require('path') as typeof import('path')
  const main = join(__dirname, '..', 'modules', 'call-service', 'android', 'src', 'main')

  it('déclare les deux widgets, sans permission en plus', () => {
    const manifest = readFileSync(join(main, 'AndroidManifest.xml'), 'utf8')
    for (const w of ['MessagesWidget', 'VoiceWidget']) expect(manifest).toContain(`com.forgechat.callservice.${w}"`)
    expect(manifest).toContain('android.appwidget.action.APPWIDGET_UPDATE')
    expect(manifest).not.toContain('REQUEST_INSTALL_PACKAGES')
    for (const f of ['xml/forge_widget_messages.xml', 'xml/forge_widget_voice.xml', 'layout/forge_widget.xml']) {
      expect(readFileSync(join(main, 'res', f), 'utf8')).toContain('<?xml')
    }
  })

  it("le module expose updateWidgets avec les 4 textes préparés par l'appli", () => {
    const kt = readFileSync(join(main, 'java', 'com', 'forgechat', 'callservice', 'CallServiceModule.kt'), 'utf8')
    expect(kt).toMatch(/Function\("updateWidgets"\) \{ messagesTitle: String, messagesBody: String, voiceTitle: String, voiceBody: String ->/)
  })
})
