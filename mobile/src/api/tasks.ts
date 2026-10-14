import { normalizeTasks, type ChannelTask, type TaskPriority } from '@/features/tasks/tasks'
import { http, path } from '@/lib/http'

/** Tâches kanban d'un salon (handlers/moderation.rs) ; tout membre du salon peut lister et créer. */
export const tasksApi = {
  async list(channelId: string): Promise<ChannelTask[]> {
    return normalizeTasks(await http.get<unknown>(path`/channels/${channelId}/tasks`))
  },
  create: (channelId: string, body: { title: string; description?: string; priority: TaskPriority }) =>
    http.post(path`/channels/${channelId}/tasks`, body),
  setCompleted: (channelId: string, taskId: string, completed: boolean) =>
    http.put(path`/channels/${channelId}/tasks/${taskId}`, { completed }),
  remove: (channelId: string, taskId: string) => http.delete(path`/channels/${channelId}/tasks/${taskId}`),
}
