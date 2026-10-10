import { desktopInvoke, isDesktop } from './desktop'

/** OBS, Streamlabs, XSplit… lancé sur l'ordinateur ? Toujours faux sur le web. */
export async function isStreamingSoftwareRunning(): Promise<boolean> {
  if (!isDesktop) return false
  return desktopInvoke<boolean>('streaming_software_running').catch(() => false)
}
