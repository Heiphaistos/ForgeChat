import * as Passkeys from 'react-native-passkeys'
import { passkeysApi } from '@/api/passkeys'
import {
  PasskeyCancelled, assertionBody, attestationBody, createPasskey, creationRequest, getPasskey, isCancel,
  passkeySupported, requestRequest, toB64u,
} from '@/lib/passkey'

const mockCreate = jest.fn()
const mockGet = jest.fn()
jest.mock('react-native-passkeys', () => ({ isSupported: jest.fn(() => true), create: (r: unknown) => mockCreate(r), get: (r: unknown) => mockGet(r) }))
const mockPost = jest.fn()
const mockDelete = jest.fn()
jest.mock('@/lib/http', () => ({
  http: { get: jest.fn(), post: (...a: unknown[]) => mockPost(...a), delete: (...a: unknown[]) => mockDelete(...a) },
  path: (s: TemplateStringsArray, ...p: string[]) => s.reduce((o, x, i) => o + x + (p[i] !== undefined ? encodeURIComponent(p[i]) : ''), ''),
}))

const regOptions = {
  challenge: 'Y2hhbGxlbmdl',
  rp: { id: 'forgechat.heiphaistos.org', name: 'ForgeChat' },
  user: { id: 'dXNlcg', name: 'momo', displayName: 'momo' },
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
  authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  excludeCredentials: [{ type: 'public-key', id: 'ZXhpc3Rpbmc' }],
  attestation: 'direct',
  timeout: 300000,
}
const getOptions = {
  challenge: 'Y2g',
  rpId: 'forgechat.heiphaistos.org',
  allowCredentials: [{ type: 'public-key', id: 'a2V5' }],
  userVerification: 'preferred',
  timeout: 120000,
}

beforeEach(() => {
  mockCreate.mockReset()
  mockGet.mockReset()
  mockPost.mockReset()
  mockDelete.mockReset()
})

describe('encodage base64url', () => {
  it('normalise base64 standard et base64url (sans =)', () => {
    expect(toB64u('a+b/c==')).toBe('a-b_c')
    expect(toB64u('a-b_c')).toBe('a-b_c')
  })
})

describe('options serveur -> module natif', () => {
  it("garde les champs du serveur et impose l'attestation « none »", () => {
    const r = creationRequest(regOptions)
    expect(r).toMatchObject({ challenge: 'Y2hhbGxlbmdl', rp: regOptions.rp, user: regOptions.user, attestation: 'none', timeout: 300000 })
    expect(r.excludeCredentials).toEqual([{ type: 'public-key', id: 'ZXhpc3Rpbmc' }])
  })
  it('refuse des options incompletes', () => {
    expect(() => creationRequest({ ...regOptions, challenge: '' })).toThrow()
    expect(() => creationRequest({ ...regOptions, user: undefined })).toThrow()
    expect(() => requestRequest({ ...getOptions, rpId: undefined })).toThrow()
    expect(() => requestRequest(null)).toThrow()
  })
  it('connexion : rpId, cles autorisees, verification preferee par defaut', () => {
    expect(requestRequest(getOptions)).toMatchObject({ rpId: getOptions.rpId, allowCredentials: getOptions.allowCredentials })
    expect(requestRequest({ challenge: 'c', rpId: 'x' }).userVerification).toBe('preferred')
  })
})

describe('reponses natives -> corps serveur', () => {
  it('enregistrement : clientDataJSON et attestationObject en base64url', () => {
    expect(attestationBody({ response: { clientDataJSON: 'a+b==', attestationObject: 'c/d=' } })).toEqual({ clientDataJSON: 'a-b', attestationObject: 'c_d' })
    expect(() => attestationBody({ response: { clientDataJSON: 'x' } })).toThrow()
    expect(() => attestationBody(null)).toThrow()
  })
  it('connexion : id, clientDataJSON, authenticatorData, signature', () => {
    const body = assertionBody({ id: 'a+b', response: { clientDataJSON: 'c', authenticatorData: 'd', signature: 'e/f' } })
    expect(body).toEqual({ id: 'a-b', clientDataJSON: 'c', authenticatorData: 'd', signature: 'e_f' })
    expect(() => assertionBody({ id: 'x', response: {} })).toThrow()
  })
})

describe('ceremonies natives', () => {
  it('cree une cle', async () => {
    mockCreate.mockResolvedValue({ id: 'i', response: { clientDataJSON: 'cd', attestationObject: 'ao' } })
    await expect(createPasskey(regOptions)).resolves.toEqual({ clientDataJSON: 'cd', attestationObject: 'ao' })
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ attestation: 'none' }))
  })
  it('signe le defi de connexion', async () => {
    mockGet.mockResolvedValue({ id: 'i', response: { clientDataJSON: 'cd', authenticatorData: 'ad', signature: 'sg' } })
    await expect(getPasskey(getOptions)).resolves.toEqual({ id: 'i', clientDataJSON: 'cd', authenticatorData: 'ad', signature: 'sg' })
  })
  it('annulation (Android, iOS, resultat vide) -> PasskeyCancelled', async () => {
    mockCreate.mockRejectedValueOnce(new Error('UserCancelled'))
    await expect(createPasskey(regOptions)).rejects.toBeInstanceOf(PasskeyCancelled)
    mockGet.mockRejectedValueOnce(new Error('User cancelled the passkey interaction'))
    await expect(getPasskey(getOptions)).rejects.toBeInstanceOf(PasskeyCancelled)
    mockGet.mockResolvedValueOnce(null)
    await expect(getPasskey(getOptions)).rejects.toBeInstanceOf(PasskeyCancelled)
    expect(isCancel(new Error('boom'))).toBe(false)
  })
  it('autre erreur native -> message generique, sans detail ni contenu de la requete', async () => {
    mockGet.mockRejectedValue(new Error('Your Apple app site association is not properly configured. challenge=Y2g'))
    const err = await getPasskey(getOptions).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(PasskeyCancelled)
    expect((err as Error).message).not.toMatch(/association|Y2g/)
  })
  it('options invalides : jamais envoyees au module natif', async () => {
    await expect(getPasskey({ challenge: '' })).rejects.toThrow()
    expect(mockGet).not.toHaveBeenCalled()
  })
  it('support : suit le module, faux sil leve', () => {
    expect(passkeySupported()).toBe(true)
    ;(Passkeys.isSupported as jest.Mock).mockImplementationOnce(() => {
      throw new Error('no module')
    })
    expect(passkeySupported()).toBe(false)
  })
})

describe('API passkeys', () => {
  it('ajout : code 2FA nettoye dans start, puis nom + reponse dans finish', async () => {
    mockPost.mockResolvedValueOnce(regOptions).mockResolvedValueOnce({ id: 'k1', name: 'Pixel' })
    mockCreate.mockResolvedValue({ id: 'i', response: { clientDataJSON: 'cd', attestationObject: 'ao' } })
    await expect(passkeysApi.add('  Pixel ', '123 456')).resolves.toEqual({ id: 'k1', name: 'Pixel' })
    expect(mockPost).toHaveBeenNthCalledWith(1, '/auth/passkeys/register/start', { code: '123456' }, { noQueue: true })
    expect(mockPost).toHaveBeenNthCalledWith(2, '/auth/passkeys/register/finish', { name: 'Pixel', clientDataJSON: 'cd', attestationObject: 'ao' }, { noQueue: true })
  })
  it("ajout annule : rien n'est envoye a finish", async () => {
    mockPost.mockResolvedValueOnce(regOptions)
    mockCreate.mockRejectedValue(new Error('UserCancelled'))
    await expect(passkeysApi.add('Pixel', '123456')).rejects.toBeInstanceOf(PasskeyCancelled)
    expect(mockPost).toHaveBeenCalledTimes(1)
  })
  it('code refuse au start : pas de ceremonie', async () => {
    mockPost.mockRejectedValueOnce(new Error('Code invalide'))
    await expect(passkeysApi.add('Pixel', '000000')).rejects.toThrow('Code invalide')
    expect(mockCreate).not.toHaveBeenCalled()
  })
  it('suppression : id encode dans le chemin, code dans le corps JSON', async () => {
    mockDelete.mockResolvedValue({ ok: true })
    await passkeysApi.remove('a/b', ' 12 34 56 ')
    expect(mockDelete).toHaveBeenCalledWith('/auth/passkeys/a%2Fb', { body: { code: '123456' }, noQueue: true })
  })
})
