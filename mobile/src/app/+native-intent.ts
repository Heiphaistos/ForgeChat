import { safeIncomingPath } from '@/lib/deepLinks'

/** Tout lien système entrant passe par ce filtre (voir lib/deepLinks.safeIncomingPath). */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return safeIncomingPath(path)
  } catch {
    return '/' // ne jamais lever ici (exécuté hors du contexte de l'app)
  }
}
