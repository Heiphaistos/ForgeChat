// Persistance Zustand dans un fichier JSON du dossier privé de l'appli, pour les préférences
// trop grosses pour le trousseau (SecureStore : ~2 Ko par valeur). Rien de secret ici.
import { requireOptionalNativeModule } from 'expo'
import type { StateStorage } from 'zustand/middleware'

interface NativeFile { readonly exists: boolean; bytesSync(): Uint8Array; write(content: Uint8Array): void; create(o?: { overwrite?: boolean }): void; delete(): void }
interface FsModule { FileSystemFile: new (uri: string) => NativeFile; documentDirectory: string }
const fs = requireOptionalNativeModule<FsModule>('FileSystem')
const file = (name: string) => (fs ? new fs.FileSystemFile(`${fs.documentDirectory.replace(/\/?$/, '/')}${name.replace(/[^A-Za-z0-9._-]/g, '_')}.json`) : null)

export const fileStateStorage: StateStorage = {
  getItem: (name) => {
    try {
      const f = file(name)
      return f?.exists ? new TextDecoder().decode(f.bytesSync()) : null
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    try {
      const f = file(name)
      if (!f) return
      if (!f.exists) f.create({ overwrite: true })
      f.write(new TextEncoder().encode(value))
    } catch {
      /* stockage indisponible : l'état reste en mémoire */
    }
  },
  removeItem: (name) => {
    try {
      const f = file(name)
      if (f?.exists) f.delete()
    } catch {
      /* rien à effacer */
    }
  },
}
