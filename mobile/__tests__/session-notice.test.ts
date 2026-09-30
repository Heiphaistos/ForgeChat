import { ApiError, SessionExpiredError } from '@/lib/http'
import { classifyBootstrapFailure } from '@/lib/sessionNotice'

describe('classifyBootstrapFailure', () => {
  it('session refusée par le serveur → expired (effacement + message)', () => {
    expect(classifyBootstrapFailure(new SessionExpiredError())).toBe('expired')
    expect(classifyBootstrapFailure(new ApiError(401, 'x'))).toBe('expired')
    expect(classifyBootstrapFailure(new ApiError(403, 'x'))).toBe('expired')
  })

  it('panne passagère → retry (jetons conservés)', () => {
    expect(classifyBootstrapFailure(new ApiError(0, 'Réseau indisponible', 'network'))).toBe('retry')
    expect(classifyBootstrapFailure(new ApiError(500, 'Erreur'))).toBe('retry')
    expect(classifyBootstrapFailure(new ApiError(503, 'Erreur'))).toBe('retry')
    expect(classifyBootstrapFailure(new ApiError(429, 'Trop', 'rate_limited'))).toBe('retry')
    expect(classifyBootstrapFailure(new Error('inattendu'))).toBe('retry')
  })
})
