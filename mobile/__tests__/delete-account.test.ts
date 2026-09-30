import { deleteAccountError } from '@/features/account/deleteAccount'

describe('deleteAccountError', () => {
  it('exige le mot de confirmation (casse et espaces tolérés)', () => {
    expect(deleteAccountError('pw', '')).toMatch(/SUPPRIMER/)
    expect(deleteAccountError('pw', 'supprime')).toMatch(/SUPPRIMER/)
    expect(deleteAccountError('pw', ' supprimer ')).toBeNull()
  })

  it('exige le mot de passe, sans le modifier', () => {
    expect(deleteAccountError('', 'SUPPRIMER')).toMatch(/mot de passe/)
    expect(deleteAccountError(' ', 'SUPPRIMER')).toBeNull() // un espace peut faire partie du mot de passe
  })
})
