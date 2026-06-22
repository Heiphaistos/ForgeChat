import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, X, AlertCircle } from 'lucide-react'
import api from '../../api/client'
import toast from 'react-hot-toast'

interface Task {
  id: string
  title: string
  description?: string
  status: 'todo' | 'in_progress' | 'review' | 'done'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  assignee_id?: string
  assignee_username?: string
  assignee_avatar?: string
  due_date?: string
  created_at: string
}

interface KanbanBoardProps {
  serverId: string
  channelId: string
}

type Col = Task['status']

const COLUMNS: { id: Col; label: string }[] = [
  { id: 'todo',        label: 'Todo' },
  { id: 'in_progress', label: 'En cours' },
  { id: 'review',      label: 'En review' },
  { id: 'done',        label: 'Terminé' },
]

const PRIORITY_BADGE: Record<Task['priority'], { label: string; cls: string }> = {
  low:    { label: 'Low',    cls: 'bg-zinc-500/20 text-zinc-400' },
  medium: { label: 'Medium', cls: 'bg-blue-500/20 text-blue-300' },
  high:   { label: 'High',   cls: 'bg-orange-500/20 text-orange-300' },
  urgent: { label: 'Urgent', cls: 'bg-red-500/20 text-red-300' },
}

function dueDateClass(due?: string): string {
  if (!due) return ''
  const diff = new Date(due).getTime() - Date.now()
  if (diff < 0) return 'text-red-400'
  if (diff < 86_400_000) return 'text-orange-400'
  return 'text-fc-muted'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}

interface CreateFormProps {
  channelId: string
  onClose: () => void
  onCreated: () => void
}

function CreateTaskForm({ channelId, onClose, onCreated }: CreateFormProps) {
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<Task['priority']>('medium')
  const [desc, setDesc] = useState('')

  const createTask = useMutation({
    mutationFn: (body: { title: string; description?: string; priority: Task['priority'] }) =>
      api.post(`/channels/${channelId}/tasks`, body),
    onSuccess: () => { onCreated(); toast.success('Tâche créée') },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur création'),
  })

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!title.trim()) return
    createTask.mutate({ title: title.trim(), description: desc.trim() || undefined, priority })
  }

  return (
    <form onSubmit={submit} className="mt-2 bg-fc-input rounded-lg p-3 space-y-2">
      <input
        autoFocus
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Titre de la tâche..."
        maxLength={200}
        className="w-full bg-transparent text-white text-sm outline-none placeholder:text-fc-muted"
      />
      <textarea
        value={desc}
        onChange={e => setDesc(e.target.value)}
        placeholder="Description (optionnelle)"
        rows={2}
        maxLength={1000}
        className="w-full bg-transparent text-white text-xs outline-none placeholder:text-fc-muted resize-none"
      />
      <div className="flex items-center justify-between gap-2">
        <select
          value={priority}
          onChange={e => setPriority(e.target.value as Task['priority'])}
          className="bg-fc-hover text-white text-xs rounded px-2 py-1 outline-none"
        >
          {(['low', 'medium', 'high', 'urgent'] as Task['priority'][]).map(p => (
            <option key={p} value={p}>{PRIORITY_BADGE[p].label}</option>
          ))}
        </select>
        <div className="flex gap-1.5">
          <button type="button" onClick={onClose} className="p-1 text-fc-muted hover:text-white rounded hover:bg-fc-hover transition">
            <X size={14} />
          </button>
          <button
            type="submit"
            disabled={!title.trim() || createTask.isPending}
            className="px-3 py-1 bg-fc-accent hover:bg-indigo-500 text-white text-xs rounded font-medium transition disabled:opacity-50"
          >
            Ajouter
          </button>
        </div>
      </div>
    </form>
  )
}

interface TaskCardProps {
  task: Task
  onDragStart: (id: string) => void
  onDelete: (id: string) => void
}

function TaskCard({ task, onDragStart, onDelete }: TaskCardProps) {
  const badge = PRIORITY_BADGE[task.priority]
  return (
    <div
      draggable
      onDragStart={() => onDragStart(task.id)}
      className="bg-fc-channel rounded-lg p-3 cursor-grab active:cursor-grabbing select-none hover:bg-fc-hover/30 transition group"
    >
      <div className="flex items-start justify-between gap-1 mb-1.5">
        <span className="text-sm text-white font-medium leading-snug break-words">{task.title}</span>
        <button
          onClick={e => { e.stopPropagation(); onDelete(task.id) }}
          className="opacity-0 group-hover:opacity-100 p-0.5 text-fc-muted hover:text-red-400 transition flex-shrink-0"
        >
          <X size={12} />
        </button>
      </div>

      {task.description && (
        <p className="text-xs text-fc-muted line-clamp-2 mb-2">{task.description}</p>
      )}

      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${badge.cls}`}>
          {badge.label}
        </span>

        {task.due_date && (
          <span className={`text-xs flex items-center gap-0.5 ${dueDateClass(task.due_date)}`}>
            {dueDateClass(task.due_date) === 'text-red-400' && <AlertCircle size={10} />}
            {formatDate(task.due_date)}
          </span>
        )}

        {task.assignee_avatar ? (
          <img
            src={task.assignee_avatar}
            alt={task.assignee_username ?? ''}
            className="w-5 h-5 rounded-full ml-auto flex-shrink-0 object-cover"
            title={task.assignee_username}
          />
        ) : task.assignee_username ? (
          <span
            className="w-5 h-5 rounded-full bg-fc-accent/40 text-white text-[9px] font-bold flex items-center justify-center ml-auto flex-shrink-0 uppercase"
            title={task.assignee_username}
          >
            {task.assignee_username[0]}
          </span>
        ) : (
          <span className="w-5 h-5 rounded-full border border-dashed border-fc-hover flex items-center justify-center ml-auto flex-shrink-0 text-fc-muted">
            <Plus size={8} />
          </span>
        )}
      </div>
    </div>
  )
}

export default function KanbanBoard({ channelId }: KanbanBoardProps) {
  const qc = useQueryClient()
  const [openCreateCol, setOpenCreateCol] = useState<Col | null>(null)
  const dragId = useRef<string | null>(null)

  const { data: tasks = [], isError } = useQuery<Task[]>({
    queryKey: ['tasks', channelId],
    queryFn: () => api.get(`/channels/${channelId}/tasks`).then(r => r.data),
    retry: 1,
  })

  const updateTask = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Pick<Task, 'status' | 'title' | 'priority' | 'due_date' | 'assignee_id'>> }) =>
      api.put(`/channels/${channelId}/tasks/${id}`, body),
    onMutate: async ({ id, body }) => {
      await qc.cancelQueries({ queryKey: ['tasks', channelId] })
      const prev = qc.getQueryData<Task[]>(['tasks', channelId]) ?? []
      qc.setQueryData<Task[]>(
        ['tasks', channelId],
        prev.map(t => t.id === id ? { ...t, ...body } : t),
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['tasks', channelId], ctx.prev)
      toast.error('Déplacement échoué — rollback')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['tasks', channelId] }),
  })

  const deleteTask = useMutation({
    mutationFn: (id: string) => api.delete(`/channels/${channelId}/tasks/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks', channelId] })
      toast.success('Tâche supprimée')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur suppression'),
  })

  const handleDrop = (col: Col) => {
    const id = dragId.current
    if (!id) return
    const task = tasks.find(t => t.id === id)
    if (!task || task.status === col) return
    updateTask.mutate({ id, body: { status: col } })
    dragId.current = null
  }

  const byCol = (col: Col) => tasks.filter(t => t.status === col)

  if (isError) {
    return (
      <div className="flex items-center justify-center h-64 text-fc-muted text-sm">
        <div className="text-center space-y-2">
          <AlertCircle size={32} className="mx-auto text-fc-muted/40" />
          <p>Impossible de charger les tâches.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-3 h-full overflow-x-auto pb-2 px-1">
      {COLUMNS.map(col => {
        const colTasks = byCol(col.id)
        return (
          <div
            key={col.id}
            className="flex flex-col flex-shrink-0 w-64 bg-fc-bg/60 rounded-xl overflow-hidden"
            onDragOver={e => e.preventDefault()}
            onDrop={() => handleDrop(col.id)}
          >
            {/* En-tête colonne */}
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-fc-hover">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-white uppercase tracking-wide">{col.label}</span>
                <span className="text-xs bg-fc-hover text-fc-muted rounded-full px-1.5 py-0.5 font-medium min-w-[20px] text-center">
                  {colTasks.length}
                </span>
              </div>
              <button
                onClick={() => setOpenCreateCol(openCreateCol === col.id ? null : col.id)}
                className="p-0.5 text-fc-muted hover:text-white hover:bg-fc-hover rounded transition"
                title="Ajouter une tâche"
              >
                <Plus size={14} />
              </button>
            </div>

            {/* Form inline */}
            {openCreateCol === col.id && (
              <div className="px-2 pt-2">
                <CreateTaskForm
                  channelId={channelId}
                  onClose={() => setOpenCreateCol(null)}
                  onCreated={() => {
                    qc.invalidateQueries({ queryKey: ['tasks', channelId] })
                    setOpenCreateCol(null)
                  }}
                />
              </div>
            )}

            {/* Cards */}
            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2 min-h-[80px]">
              {colTasks.length === 0 && openCreateCol !== col.id && (
                <p className="text-xs text-fc-muted/50 text-center pt-4 select-none">Aucune tâche</p>
              )}
              {colTasks.map(task => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onDragStart={id => { dragId.current = id }}
                  onDelete={id => deleteTask.mutate(id)}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
