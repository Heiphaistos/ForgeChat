import { channelsApi } from '@/api/channels'
import { supportsWaitingRoom, waitingRoomChange } from '@/features/voice/waitingRoom'
import { http } from '@/lib/http'

jest.mock('@/lib/http', () => ({ ...jest.requireActual('@/lib/http'), http: { put: jest.fn() } }))

describe('salle d’attente (voice_waiting.rs::set_waiting_room)', () => {
  it('seulement voice et stage (le serveur ignore les autres types)', () => {
    expect(['voice', 'stage'].every(supportsWaitingRoom)).toBe(true)
    expect(['video', 'text', 'forum', 'announcement'].some(supportsWaitingRoom)).toBe(false)
  })
  it('n’envoie que si le réglage change', () => {
    expect(waitingRoomChange('voice', false, true)).toBe(true)
    expect(waitingRoomChange('stage', true, false)).toBe(false)
    expect(waitingRoomChange('voice', undefined, false)).toBeNull()
    expect(waitingRoomChange('voice', true, true)).toBeNull()
    expect(waitingRoomChange('video', false, true)).toBeNull()
  })
  it('PUT /servers/:s/channels/:c/waiting-room { enabled }', async () => {
    await channelsApi.setWaitingRoom('s1', 'c1', true)
    expect(http.put).toHaveBeenCalledWith('/servers/s1/channels/c1/waiting-room', { enabled: true })
  })
})
