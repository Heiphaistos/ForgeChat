import { serversApi } from '@/api/servers'
import { logger } from '@/lib/logger'
import type { Server } from '@/types/models'
import { planBuiltinCreation, type ServerTemplate } from './templates'

/**
 * Crée un serveur, vide ou depuis un modèle. Modèle partagé : le serveur fait tout
 * (POST /templates/:id/use). Modèle intégré : création comme le client web, salon par salon ;
 * un salon qui échoue n'empêche pas les suivants (même tolérance que le web).
 */
export async function createServer(name: string, template: ServerTemplate | null, description?: string): Promise<Server> {
  if (template && template.source !== 'builtin') return serversApi.useTemplate(template.id, name)

  const server = await serversApi.create(name, description)
  if (!template) return server

  const plan = planBuiltinCreation(template.data)
  const defaults = plan.replaceDefaultGeneral ? await serversApi.channels(server.id).catch(() => []) : []
  const catIds = new Map<string, string>()
  for (const cat of plan.categories) {
    try {
      catIds.set(cat.key, (await serversApi.createCategory(server.id, cat.name)).id)
    } catch (e) {
      logger.warn('servers', 'catégorie du modèle', e)
    }
  }
  for (const ch of plan.channels) {
    try {
      await serversApi.createChannel(server.id, ch.name, ch.type, ch.categoryKey ? (catIds.get(ch.categoryKey) ?? null) : null)
    } catch (e) {
      logger.warn('servers', 'salon du modèle', e)
    }
  }
  // Le salon « général » créé d'office par le serveur fait doublon avec celui du modèle.
  for (const ch of defaults) {
    if (ch.type === 'text' && ch.name === 'général' && !ch.category_id) {
      await serversApi.deleteChannel(server.id, ch.id).catch((e: unknown) => logger.warn('servers', 'salon par défaut', e))
    }
  }
  return server
}
