import {
  needsResync,
  parsePlayerEvent,
  parseWatch,
  parseYouTubeId,
  playerScript,
  syncCommands,
  watchErrorMessage,
  watchLink,
  watchPosition,
  type PlayerReport,
} from '@/lib/watchTogether'

const ev = { type: 'WATCH_STATE', channel_id: 'c1', item: 3, video_id: 'dQw4w9WgXcQ', playing: true, position: 30, queue: ['aaaaaaaaaaa'], by: 'u1' }

describe('Regarder ensemble', () => {
  it('valide l’état reçu', () => {
    expect(parseWatch(ev, 0)).toMatchObject({ channelId: 'c1', item: 3, videoId: 'dQw4w9WgXcQ', queue: 1, by: 'u1' })
    expect(parseWatch({ ...ev, video_id: 'https://evil.example' }, 0)).toBeNull()
    expect(parseWatch({ ...ev, position: Number.NaN }, 0)).toBeNull()
    expect(parseWatch({ ...ev, item: undefined }, 0)).toBeNull()
  })

  it('ouvre YouTube à la position du salon', () => {
    const w = parseWatch(ev, 1000)!
    expect(watchPosition(w, 6000)).toBe(35)
    expect(watchLink(w, 6000)).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=35s')
    const paused = parseWatch({ ...ev, playing: false, position: 0 }, 1000)!
    expect(watchLink(paused, 60_000)).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  })

  it('valide les adresses comme le web et le serveur', () => {
    expect(parseYouTubeId(' https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10 ')).toBe('dQw4w9WgXcQ')
    expect(parseYouTubeId('youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(parseYouTubeId('https://m.youtube.com/shorts/dQw4w9WgXcQ/')).toBe('dQw4w9WgXcQ')
    expect(parseYouTubeId('https://evil.example/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(parseYouTubeId('https://youtube.com/watch?v=court')).toBeNull()
    expect(watchErrorMessage('queue_full')).toContain('20')
    expect(watchErrorMessage('inconnu')).toBe('Action refusée.')
  })
})

describe('Pont du lecteur intégré', () => {
  it('sérialise les commandes', () => {
    expect(playerScript({ type: 'seek', position: 12 })).toBe('window.fcCmd({"type":"seek","position":12});true;')
  })

  it('valide les messages de la page', () => {
    expect(parsePlayerEvent('{"type":"ready"}')).toEqual({ type: 'ready' })
    expect(parsePlayerEvent('{"type":"error","code":150}')).toEqual({ type: 'error', code: 150 })
    expect(parsePlayerEvent('{"type":"state","state":3,"currentTime":4.5,"duration":60}')).toEqual({
      type: 'state', playing: true, ended: false, time: 4.5, duration: 60,
    })
    expect(parsePlayerEvent('{"type":"state","state":1,"currentTime":"x","duration":60}')).toBeNull()
    expect(parsePlayerEvent('{"type":"eval"}')).toBeNull()
    expect(parsePlayerEvent('pas du json')).toBeNull()
    expect(parsePlayerEvent('null')).toBeNull()
  })
})

describe('Synchronisation', () => {
  const w = parseWatch(ev, 1000)!
  const report = (p: Partial<PlayerReport>): PlayerReport => ({ type: 'state', playing: true, ended: false, time: 35, duration: 300, at: 6000, ...p })

  it('recale au-delà de 2 s, 0,5 s quand un participant vient d’agir', () => {
    expect(needsResync(10, 12)).toBe(false)
    expect(needsResync(10, 12.5)).toBe(true)
    expect(needsResync(10, 10.6, 0.5)).toBe(true)
  })

  it('charge la vidéo à la position cible quand l’item change', () => {
    expect(syncCommands(w, null, null, 6000, true)).toEqual([{ type: 'load', videoId: 'dQw4w9WgXcQ', position: 35, playing: true }])
    expect(syncCommands(w, 2, report({}), 6000, false)[0]?.type).toBe('load')
  })

  it('ne touche à rien quand le lecteur suit', () => {
    expect(syncCommands(w, 3, report({}), 6000, false)).toEqual([])
    // Rapport vieux d'une seconde mais lecteur en marche : extrapolé, pas de recalage.
    expect(syncCommands(w, 3, report({ time: 34, at: 5000 }), 6000, true)).toEqual([])
  })

  it('relance, met en pause et recale', () => {
    expect(syncCommands(w, 3, report({ playing: false, time: 20 }), 6000, false)).toEqual([{ type: 'play' }, { type: 'seek', position: 35 }])
    const paused = parseWatch({ ...ev, playing: false }, 1000)!
    expect(syncCommands(paused, 3, report({ time: 30 }), 6000, false)).toEqual([{ type: 'pause' }])
    expect(syncCommands(w, 3, report({ time: 40 }), 6000, true)).toEqual([{ type: 'seek', position: 35 }])
  })

  it('laisse finir la vidéo terminée', () => {
    const end = parseWatch({ ...ev, position: 299.5 }, 6000)!
    expect(syncCommands(end, 3, report({ playing: false, ended: true, time: 300 }), 6000, false)).toEqual([])
  })
})
