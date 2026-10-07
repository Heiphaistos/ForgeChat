import { serversApi } from '@/api/servers'
import type { Server } from '@/types/models'
import type { ServerTemplate } from './templates'

/**
 * Crée un serveur, vide ou depuis un modèle : le serveur crée toute la structure en une
 * transaction (modèle intégré : POST /servers {template} ; partagé : POST /templates/:id/use).
 */
export function createServer(name: string, template: ServerTemplate | null, description?: string): Promise<Server> {
  if (template && template.source !== 'builtin') return serversApi.useTemplate(template.id, name)
  return serversApi.create(name, description, template?.id)
}
