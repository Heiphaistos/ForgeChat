// Tests : configuration Expo explicite (adresse d'exemple factice). L'app n'a AUCUNE adresse de
// serveur par défaut : sans ceci, src/config/env.ts refuse de démarrer (comme une app mal construite).
jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants')
  const base = actual.default ?? actual
  const constants = {
    ...base,
    expoConfig: { ...(base.expoConfig ?? {}), version: '1.0.0', extra: { apiUrl: 'https://chat.example.org', appEnv: 'development' } },
  }
  return { __esModule: true, ...actual, default: constants }
})
