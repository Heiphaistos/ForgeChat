import { needsPhotoPermission } from '@/lib/photoAccess'

describe('accès aux photos', () => {
  it('Android : aucune permission (sélecteur de photos du système)', () => {
    expect(needsPhotoPermission('android')).toBe(false)
  })
  it('iOS : permission photos demandée', () => {
    expect(needsPhotoPermission('ios')).toBe(true)
  })
})
