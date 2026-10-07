// Notes privées sur une personne, chiffrées avec la clé de compte (lot « Profil et social ») :
// le serveur ne reçoit qu'un blob opaque {v, iv, ct}. Une ancienne note en clair est
// rechiffrée ici dès sa première lecture, et le serveur efface alors le clair.
import api from '../api/client'
import { useAuth } from '../store/auth'
import { useAccountKey } from './accountKey'
import * as c from './crypto'

interface NoteResponse { enc: c.ConvWrapped | null; content: string }
export type NoteResult = { text: string; locked: false } | { text: null; locked: true }

function myKey() {
  const { status, priv, pub } = useAccountKey.getState()
  const me = useAuth.getState().user?.id
  return status === 'ready' && priv && pub && me ? { priv, pub: c.b64uDecode(pub), me } : null
}

export async function saveNote(target: string, text: string): Promise<void> {
  const key = myKey()
  if (!key) throw new Error('LOCKED')
  const enc = text.trim() ? await c.sealNote(key.priv, key.pub, key.me, target, text) : null
  await api.put(`/notes/${target}`, { enc })
}

/** Note déchiffrée sur l'appareil ; `locked` si la clé de compte n'est pas ouverte. */
export async function loadNote(target: string): Promise<NoteResult> {
  const { data } = await api.get<NoteResponse>(`/notes/${target}`)
  const key = myKey()
  if (data.enc) {
    if (!key) return { text: null, locked: true }
    return { text: await c.openNote(key.priv, key.pub, data.enc, key.me, target), locked: false }
  }
  const legacy = data.content ?? ''
  if (legacy && key) await saveNote(target, legacy).catch(() => { /* rechiffrée à la prochaine lecture */ })
  return { text: legacy, locked: false }
}
