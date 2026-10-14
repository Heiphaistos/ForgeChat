import { isUuid } from '@/lib/params'

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export type TaskPriority = (typeof PRIORITIES)[number]

/** Tâche de salon (moderation.rs::ChannelTask). Le serveur ne stocke qu'un booléen `completed` : deux colonnes. */
export interface ChannelTask {
  id: string
  title: string
  description: string | null
  completed: boolean
  priority: TaskPriority
  creatorId: string | null
  dueDate: string | null
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

export function normalizeTasks(raw: unknown): ChannelTask[] {
  if (!Array.isArray(raw)) return []
  return raw.map(obj).flatMap((r) =>
    isUuid(r.id) && typeof r.title === 'string'
      ? [
          {
            id: r.id.toLowerCase(),
            title: r.title,
            description: typeof r.description === 'string' && r.description ? r.description : null,
            completed: r.completed === true,
            priority: PRIORITIES.find((p) => p === r.priority) ?? 'normal',
            creatorId: isUuid(r.creator_id) ? r.creator_id.toLowerCase() : null,
            dueDate: typeof r.due_date === 'string' ? r.due_date : null,
          },
        ]
      : [],
  )
}

/** Corps de POST /channels/:id/tasks : titre 1-200 (côté serveur aussi), description facultative ; null si titre vide. */
export function createTaskBody(title: string, description: string, priority: TaskPriority) {
  const tt = title.trim()
  if (!tt || [...tt].length > 200) return null
  return { title: tt, description: description.trim() || undefined, priority }
}

/** update_task / delete_task : le créateur ou un modérateur (MANAGE_MESSAGES) ; le serveur reste seul juge. */
export const canEditTask = (task: Pick<ChannelTask, 'creatorId'>, meId: string | undefined, isModerator: boolean) =>
  isModerator || (!!meId && task.creatorId === meId)

/** Échéance dépassée / dans les 24 h, comme dueDateClass du web. */
export function dueState(due: string | null, now = Date.now()): 'late' | 'soon' | 'later' | null {
  if (!due) return null
  const diff = new Date(due).getTime() - now
  if (Number.isNaN(diff)) return null
  return diff < 0 ? 'late' : diff < 86_400_000 ? 'soon' : 'later'
}
