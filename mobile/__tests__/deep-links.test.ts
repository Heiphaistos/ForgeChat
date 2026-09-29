import { replayablePath } from '@/lib/deepLinks'

const A = '3af17b11-1c9a-4daf-8895-a2d3eec03894'
const B = '5aa172f3-305c-4685-bd77-64faf6b911eb'

describe('replayablePath (lien profond reçu app fermée)', () => {
  it('rejoue les conversations valides', () => {
    expect(replayablePath(`forgechat://dm/${A}`)).toBe(`/dm/${A}`)
    expect(replayablePath(`forgechat://group/${A}`)).toBe(`/group/${A}`)
    expect(replayablePath(`forgechat://channel/${A}/${B}`)).toBe(`/channel/${A}/${B}`)
  })

  it('normalise la casse des identifiants et ignore query / fragment', () => {
    expect(replayablePath(`forgechat://dm/${A.toUpperCase()}?x=1#y`)).toBe(`/dm/${A}`)
  })

  it('refuse les identifiants invalides ou les segments en trop', () => {
    expect(replayablePath('forgechat://dm/not-a-uuid')).toBeNull()
    expect(replayablePath(`forgechat://dm/${A}/extra`)).toBeNull()
    expect(replayablePath(`forgechat://channel/${A}`)).toBeNull()
    expect(replayablePath(`forgechat://group/${A}/../settings`)).toBeNull()
    expect(replayablePath('forgechat://dm/..%2Fsettings')).toBeNull()
  })

  it('refuse les routes hors conversations et les autres schémas', () => {
    expect(replayablePath('forgechat://settings/password')).toBeNull()
    expect(replayablePath('forgechat://invite/ABCDEF')).toBeNull() // géré par sa propre route publique
    expect(replayablePath(`https://evil.example/dm/${A}`)).toBeNull()
    expect(replayablePath(`exp+forgechat://expo-development-client/?url=x`)).toBeNull()
    expect(replayablePath('')).toBeNull()
  })
})
