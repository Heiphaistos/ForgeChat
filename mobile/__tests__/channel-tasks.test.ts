import { tasksApi } from '@/api/tasks'
import { canEditTask, createTaskBody, dueState, normalizeTasks } from '@/features/tasks/tasks'
import { http } from '@/lib/http'

jest.mock('@/lib/http', () => ({ ...jest.requireActual('@/lib/http'), http: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() } }))

const T = '3af17b11-1c9a-4daf-8895-a2d3eec03894'
const U = '9b1f4c2e-0d3a-4e5b-8c6d-7e8f9a0b1c2d'
const C = '5aa172f3-305c-4685-bd77-64faf6b911eb'

describe('normalizeTasks (moderation.rs::ChannelTask)', () => {
  it('lit les champs, borne la priorité et écarte les lignes invalides', () => {
    expect(
      normalizeTasks([
        { id: T.toUpperCase(), title: 'A', description: 'd', completed: true, priority: 'urgent', creator_id: U, due_date: '2026-10-20T10:00:00Z' },
        { id: C, title: 'B', description: '', priority: 'bizarre' },
        { id: 'x', title: 'C' },
        { id: C },
        null,
      ]),
    ).toEqual([
      { id: T, title: 'A', description: 'd', completed: true, priority: 'urgent', creatorId: U, dueDate: '2026-10-20T10:00:00Z' },
      { id: C, title: 'B', description: null, completed: false, priority: 'normal', creatorId: null, dueDate: null },
    ])
    expect(normalizeTasks({})).toEqual([])
  })
})

describe('createTaskBody', () => {
  it('titre 1-200 obligatoire, description vide omise', () => {
    expect(createTaskBody(' Faire ', '  ', 'high')).toEqual({ title: 'Faire', description: undefined, priority: 'high' })
    expect(createTaskBody('a', ' note ', 'low')?.description).toBe('note')
    expect(createTaskBody('   ', '', 'normal')).toBeNull()
    expect(createTaskBody('x'.repeat(201), '', 'normal')).toBeNull()
  })
})

describe('droits (update_task / delete_task)', () => {
  it('créateur ou modérateur, personne d’autre', () => {
    expect(canEditTask({ creatorId: U }, U, false)).toBe(true)
    expect(canEditTask({ creatorId: U }, C, false)).toBe(false)
    expect(canEditTask({ creatorId: U }, C, true)).toBe(true)
    expect(canEditTask({ creatorId: null }, undefined, false)).toBe(false)
  })
})

describe('dueState', () => {
  const now = Date.parse('2026-10-14T12:00:00Z')
  it('en retard / dans les 24 h / plus tard / sans échéance', () => {
    expect(dueState('2026-10-14T11:00:00Z', now)).toBe('late')
    expect(dueState('2026-10-15T11:00:00Z', now)).toBe('soon')
    expect(dueState('2026-10-17T12:00:00Z', now)).toBe('later')
    expect(dueState(null, now)).toBeNull()
    expect(dueState('nope', now)).toBeNull()
  })
})

describe('tasksApi', () => {
  beforeEach(() => jest.clearAllMocks())
  it('utilise les routes /channels/:id/tasks', async () => {
    ;(http.get as jest.Mock).mockResolvedValue([{ id: T, title: 'A' }])
    expect((await tasksApi.list(C))[0]?.id).toBe(T)
    expect(http.get).toHaveBeenCalledWith(`/channels/${C}/tasks`)
    await tasksApi.create(C, { title: 'A', priority: 'low' })
    expect(http.post).toHaveBeenCalledWith(`/channels/${C}/tasks`, { title: 'A', priority: 'low' })
    await tasksApi.setCompleted(C, T, true)
    expect(http.put).toHaveBeenCalledWith(`/channels/${C}/tasks/${T}`, { completed: true })
    await tasksApi.remove(C, T)
    expect(http.delete).toHaveBeenCalledWith(`/channels/${C}/tasks/${T}`)
  })
})
