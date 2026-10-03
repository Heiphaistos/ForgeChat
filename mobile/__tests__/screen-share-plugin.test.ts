import plugin from '../plugins/withScreenShare.js'

describe('config plugin du partage d’écran', () => {
  it('déclare les permissions du service au premier plan', () => {
    expect(plugin.PERMISSIONS).toEqual([
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION',
    ])
  })
})
