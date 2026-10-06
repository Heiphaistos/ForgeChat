// Importé EN PREMIER par src/app/_layout.tsx : installe les globales WebRTC de LiveKit avant
// tout autre module (doc @livekit/react-native : registerGlobals au démarrage).
import { setupLiveKit } from './livekit'

setupLiveKit()
