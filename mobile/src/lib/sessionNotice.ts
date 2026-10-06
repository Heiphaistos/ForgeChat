import { ApiError } from './http'

export const SESSION_EXPIRED_NOTICE = 'Session expirée, reconnecte-toi.'

/**
 * Échec de la reprise de session au démarrage :
 * - 'expired' : le serveur refuse la session (révoquée, expirée, compte supprimé) → effacement
 *   local et message clair sur l'écran de connexion ;
 * - 'retry'   : réseau absent, serveur en erreur (5xx) ou limité (429) → on garde les jetons et
 *   on passe hors ligne ; les effacer forcerait une reconnexion pour une panne passagère.
 */
export function classifyBootstrapFailure(e: unknown): 'expired' | 'retry' {
  if (e instanceof ApiError && (e.code === 'session_expired' || e.status === 401 || e.status === 403 || e.status === 400)) return 'expired'
  return 'retry'
}
