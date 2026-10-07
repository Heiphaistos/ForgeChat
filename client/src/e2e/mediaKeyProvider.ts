// Fournisseur de clé LiveKit des médias chiffrés (§5), sans dépendance à l'appli :
// importé aussi par le banc de test e2ee-harness.
import { BaseKeyProvider, createKeyMaterialFromString } from 'livekit-client'
import { MEDIA_KEYRING } from './crypto'

/** Clé partagée par tous les participants, index choisi par nous (époque modulo l'anneau). */
export class MediaKeyProvider extends BaseKeyProvider {
  constructor() {
    // Comme ExternalE2EEKeyProvider : clé partagée, jamais de ratchet automatique
    // (une trame illisible d'un pair ne doit pas faire jeter la bonne clé).
    super({ sharedKey: true, ratchetWindowSize: 0, failureTolerance: -1, keyringSize: MEDIA_KEYRING })
  }
  async setMediaKey(key: string, index: number) {
    this.onSetEncryptionKey(await createKeyMaterialFromString(key), undefined, index)
  }
}
