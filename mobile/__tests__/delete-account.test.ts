import { deleteAccountError, deleteAccountFailure } from '@/features/account/deleteAccount'
import { ApiError } from '@/lib/http'

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

describe('deleteAccountFailure', () => {
  const err = (status: number, message: string) => new ApiError(status, message)

  it('mot de passe refusé : sous le champ, message du serveur', () => {
    expect(deleteAccountFailure(err(400, 'Mot de passe incorrect'))).toEqual({ field: 'password', message: 'Mot de passe incorrect' })
  })

  it('autre refus métier (serveur possédé) : message du serveur sous le bouton', () => {
    const m = "Vous devez d'abord supprimer les serveurs dont vous êtes propriétaire."
    expect(deleteAccountFailure(err(400, m))).toEqual({ field: 'form', message: m })
  })

  it('erreur serveur, trop d’essais, réseau : message propre, jamais le texte technique', () => {
    expect(deleteAccountFailure(err(500, 'Erreur base de données')).message).not.toMatch(/base de données/)
    expect(deleteAccountFailure(err(500, 'Erreur base de données')).message).toMatch(/n'a pas pu supprimer/)
    expect(deleteAccountFailure(err(429, 'Too many')).message).toMatch(/15 minutes/)
    expect(deleteAccountFailure(err(0, 'Réseau indisponible')).message).toMatch(/Réseau indisponible/)
    expect(deleteAccountFailure(new Error('x')).field).toBe('form')
  })
})
