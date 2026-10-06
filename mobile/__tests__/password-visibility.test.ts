import { eyeIcon, eyeLabel, maskOnAppState } from '@/lib/passwordVisibility'

describe('bouton œil des mots de passe', () => {
  it('libellé et icône suivent l’état du champ', () => {
    expect(eyeLabel(false)).toBe('Afficher le mot de passe')
    expect(eyeLabel(true)).toBe('Masquer le mot de passe')
    expect(eyeIcon(false)).toBe('eye-outline')
    expect(eyeIcon(true)).toBe('eye-off-outline')
  })

  it('remasque dès que l’app quitte le premier plan', () => {
    expect(maskOnAppState('active')).toBe(false)
    for (const s of ['background', 'inactive', 'unknown', 'extension']) expect(maskOnAppState(s)).toBe(true)
  })
})
