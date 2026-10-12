import * as Linking from 'expo-linking'
import { Platform, Share } from 'react-native'
import { requireOptionalNativeModule } from 'expo-modules-core'
import { sha256 } from '@noble/hashes/sha2.js'
import { shaMatches } from './updateCheck'
import { useUpdate } from './updateStore'

// iOS : l'IPA est téléchargée ICI, son SHA-256 comparé à la ligne de SHA256SUMS.txt signée
// (vérifiée par updateCheck avant de proposer la mise à jour), puis remise à AltStore/SideStore
// par la feuille de partage (« Ouvrir dans AltStore »). Avant, AltStore retéléchargeait l'URL
// lui-même et la re-signait : le serveur pouvait servir à ce moment-là un autre fichier.
interface NativeHandle { readBytes(n: number): Uint8Array; close(): void }
interface NativeFile { readonly uri: string; readonly exists: boolean; delete(): void; open(mode?: string): NativeHandle }
interface FsModule {
  FileSystemFile: new (uri: string) => NativeFile
  cacheDirectory: string
  downloadFileAsync(url: string, to: NativeFile, options?: { idempotent?: boolean }): Promise<string>
}
const fs = requireOptionalNativeModule<FsModule>('FileSystem')

/** SHA-256 hexadécimal d'un fichier, lu par morceaux de 1 Mio (une IPA fait ~100 Mo). */
export function sha256File(open: () => NativeHandle): string {
  const h = sha256.create()
  const f = open()
  try {
    for (let b = f.readBytes(1 << 20); b.length; b = f.readBytes(1 << 20)) h.update(b)
  } finally {
    f.close()
  }
  return Array.from(h.digest(), (x) => x.toString(16).padStart(2, '0')).join('')
}

async function installIpa(url: string, expected: string, version: string): Promise<void> {
  if (!fs) throw new Error('FS_UNAVAILABLE')
  const file = new fs.FileSystemFile(`${fs.cacheDirectory.replace(/\/?$/, '/')}ForgeChat-${version.replace(/[^0-9.]/g, '')}.ipa`)
  if (file.exists) file.delete()
  await fs.downloadFileAsync(url, file, { idempotent: true })
  if (!shaMatches(expected, sha256File(() => file.open('r')))) {
    file.delete()
    throw new Error('UPDATE_HASH_MISMATCH')
  }
  // Fichier local vérifié : choisir « AltStore » ou « SideStore » dans la feuille.
  await Share.share({ url: file.uri, title: `ForgeChat ${version}` })
}

/**
 * « Installer ». Android : le navigateur télécharge l'APK (HTTPS, serveur ForgeChat) puis l'ouvre
 * dans l'installeur du système, qui refuse tout APK signé avec une autre clé que l'app installée.
 * Pas d'installation depuis l'app : il faudrait REQUEST_INSTALL_PACKAGES, que HyperOS 3 refuse à la
 * première installation, et déposer l'APK dans Téléchargements ne proposait que des explorateurs
 * de fichiers (« Terminer l'action avec… », Xiaomi 15T Pro, 2026-10-08).
 */
export async function startUpdate(): Promise<void> {
  const { update } = useUpdate.getState()
  if (!update) return
  if (Platform.OS === 'ios') {
    useUpdate.setState({ phase: 'verifying' })
    try {
      await installIpa(update.url, update.sha256, update.version)
      useUpdate.setState({ phase: 'ready' })
    } catch (e) {
      useUpdate.setState({ phase: e instanceof Error && e.message === 'UPDATE_HASH_MISMATCH' ? 'invalid' : 'error' })
    }
    return
  }
  try {
    await Linking.openURL(update.url)
    useUpdate.setState({ phase: 'ready' })
  } catch {
    useUpdate.setState({ phase: 'error' })
  }
}
