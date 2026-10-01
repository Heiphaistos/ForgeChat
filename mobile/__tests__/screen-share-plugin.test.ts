import plugin from '../plugins/withScreenShare.js'

const MAIN = `class MainApplication : Application(), ReactApplication {
  override fun onCreate() {
    super.onCreate()
    DefaultNewArchitectureEntryPoint.releaseLevel = ReleaseLevel.STABLE
  }
}
`

describe('config plugin du partage d’écran', () => {
  it('active le service MediaProjection juste après super.onCreate(), une seule fois', () => {
    const out = plugin.enableMediaProjectionService(MAIN)
    expect(out).toContain(
      'super.onCreate()\n    // Partage d\'écran : service au premier plan mediaProjection (plugins/withScreenShare.js)\n' +
        '    com.oney.WebRTCModule.WebRTCModuleOptions.getInstance().enableMediaProjectionService = true\n',
    )
    expect(plugin.enableMediaProjectionService(out)).toBe(out)
  })

  it('échoue si MainApplication n’a pas la forme attendue', () => {
    expect(() => plugin.enableMediaProjectionService('class X {}')).toThrow(/super.onCreate/)
  })

  it('déclare les permissions du service au premier plan', () => {
    expect(plugin.PERMISSIONS).toEqual([
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION',
    ])
  })
})
