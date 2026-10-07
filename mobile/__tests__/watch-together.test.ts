import { parseWatch, watchLink, watchPosition } from '@/lib/watchTogether'

const ev = { type: 'WATCH_STATE', channel_id: 'c1', video_id: 'dQw4w9WgXcQ', playing: true, position: 30, queue: ['aaaaaaaaaaa'], by: 'u1' }

describe('Regarder ensemble', () => {
  it('valide l’état reçu', () => {
    expect(parseWatch(ev, 0)).toMatchObject({ channelId: 'c1', videoId: 'dQw4w9WgXcQ', queue: 1, by: 'u1' })
    expect(parseWatch({ ...ev, video_id: 'https://evil.example' }, 0)).toBeNull()
    expect(parseWatch({ ...ev, position: Number.NaN }, 0)).toBeNull()
  })

  it('ouvre YouTube à la position du salon', () => {
    const w = parseWatch(ev, 1000)!
    expect(watchPosition(w, 6000)).toBe(35)
    expect(watchLink(w, 6000)).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=35s')
    const paused = parseWatch({ ...ev, playing: false, position: 0 }, 1000)!
    expect(watchLink(paused, 60_000)).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  })
})
