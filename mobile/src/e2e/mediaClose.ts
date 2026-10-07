// Fermeture du chiffrement des médias d'une salle (e2e/media.ts), sans dépendance :
// services/livekit.ts l'appelle avant room.disconnect() sans charger le module natif.
import type { Room } from 'livekit-client'

export const closers = new WeakMap<Room, () => Promise<void>>()

/** À appeler AVANT room.disconnect() : libère les chiffreurs natifs pendant que la connexion vit encore. */
export async function closeMediaE2EE(room: Room) {
  await closers.get(room)?.()
}
