// Notes privées sur une personne, chiffrées avec la clé de compte (lot « Profil et
// social ») : le serveur ne reçoit qu'un blob opaque {v, iv, ct}. Même format que le
// web (client/src/e2e/notes.ts, vecteur `privateNote`). Une ancienne note en clair est
// rechiffrée dès sa première lecture, et le serveur efface alors le clair.
import { http, path } from '@/lib/http'
import { getMyId } from '@/stores/auth'
import { useAccountKey } from './accountKey'
import * as c from './crypto'

interface NoteResponse { enc: c.ConvWrapped | null; content: string }

/** Erreur levée quand la clé de compte n'est pas ouverte sur cet appareil. */
export const NOTE_LOCKED = 'LOCKED'

function myKey() {
  const { status, priv, pub } = useAccountKey.getState()
  const me = getMyId()
  return status === 'ready' && priv && pub && me ? { priv, pub: c.b64uDecode(pub), me } : null
}

export async function saveNote(target: string, text: string): Promise<void> {
  const key = myKey()
  if (!key) throw new Error(NOTE_LOCKED)
  const enc = text.trim() ? await c.sealNote(key.priv, key.pub, key.me, target, text) : null
  await http.put(path`/notes/${target}`, { enc })
}

/** Texte de la note (déchiffré sur l'appareil) ; lève NOTE_LOCKED si la clé est fermée. */
export async function loadNote(target: string): Promise<string> {
  const data = await http.get<NoteResponse>(path`/notes/${target}`)
  const key = myKey()
  if (data.enc) {
    if (!key) throw new Error(NOTE_LOCKED)
    return c.openNote(key.priv, key.pub, data.enc, key.me, target)
  }
  const legacy = data.content ?? ''
  if (legacy && key) await saveNote(target, legacy).catch(() => undefined)
  return legacy
}
