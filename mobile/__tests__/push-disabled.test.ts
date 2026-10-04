/**
 * Build sans push (première version : ni projet EAS ni Firebase) : l'app ne contacte ni Expo ni
 * Firebase, ne demande aucune permission, ne crée aucun canal et n'appelle pas le serveur.
 */

const mockNotifications = {
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
  getLastNotificationResponse: jest.fn(),
  AndroidImportance: { HIGH: 4, MAX: 5 },
  AndroidNotificationVisibility: { PRIVATE: 0, PUBLIC: 1 },
}
const mockRegister = jest.fn()

jest.mock('expo-notifications', () => mockNotifications)
jest.mock('expo-device', () => ({ isDevice: true, modelName: 'Pixel' }))
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn().mockResolvedValue(null), setItemAsync: jest.fn(), deleteItemAsync: jest.fn().mockResolvedValue(undefined) }))
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }))
jest.mock('@/api/push', () => ({ pushApi: { register: (...a: unknown[]) => mockRegister(...a), unregister: jest.fn() } }))
jest.mock('@/stores/auth', () => ({ registerPreSignOutHook: jest.fn(), registerSignOutHook: jest.fn() }))
jest.mock('@/stores/settings', () => ({ useSettings: { getState: () => ({ pushEnabled: true, pushPreview: false }) } }))
jest.mock('@/stores/unread', () => ({ useUnread: { getState: () => ({ activeConversation: null }) } }))
jest.mock('@/lib/logger', () => ({ logger: { warn: jest.fn(), debug: jest.fn() } }))

describe('push absent du build', () => {
  it('PUSH_AVAILABLE est faux sans projet EAS', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    expect(require('@/config/env').PUSH_AVAILABLE).toBe(false)
  })

  it('aucun appel aux notifications, à Expo ni au serveur', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const push = require('@/services/push') as typeof import('@/services/push')
    push.configureNotifications()
    await push.syncPushRegistration()
    push.listenNotificationTaps()()
    for (const fn of Object.values(mockNotifications)) if (typeof fn === 'function') expect(fn).not.toHaveBeenCalled()
    expect(mockRegister).not.toHaveBeenCalled()
  })
})
