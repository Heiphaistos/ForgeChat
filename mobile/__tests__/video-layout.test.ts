import {
  CONTROLS_HIDE_MS,
  createAutoHide,
  focusedTile,
  gridShape,
  mainVideoTile,
  snapToCorner,
  togglePin,
  type TileInfo,
} from '@/features/calls/videoLayout'

const tile = (key: string, o: Partial<TileInfo> = {}): TileInfo => ({ key, userId: key.split(':')[0]!, self: false, screen: false, hasVideo: true, ...o })

describe('vue focus et épingle', () => {
  const tiles = [tile('me', { self: true }), tile('a'), tile('b', { hasVideo: false })]

  it('grille sans épingle, focus sur la tuile épinglée tant qu’elle existe', () => {
    expect(focusedTile(tiles, null)).toBeNull()
    expect(focusedTile(tiles, 'a')?.key).toBe('a')
    // Participant parti : retour à la grille.
    expect(focusedTile(tiles, 'gone')).toBeNull()
  })

  it('ré-épingler libère, épingler une autre tuile la remplace', () => {
    expect(togglePin(null, 'a')).toBe('a')
    expect(togglePin('a', 'a')).toBeNull()
    expect(togglePin('a', 'b')).toBe('b')
  })
})

describe('vidéo principale (image dans l’image)', () => {
  it('épinglée > écran partagé > qui parle > première distante > la nôtre', () => {
    const me = tile('me', { self: true })
    const a = tile('a')
    const b = tile('b')
    const screen = tile('b:screen', { userId: 'b', screen: true })
    expect(mainVideoTile([me, a, b, screen], 'a', ['b'])?.key).toBe('a')
    expect(mainVideoTile([me, a, b, screen], null, ['a'])?.key).toBe('b:screen')
    expect(mainVideoTile([me, a, b], null, ['b'])?.key).toBe('b')
    expect(mainVideoTile([me, a, b], null, [])?.key).toBe('a')
    expect(mainVideoTile([me, tile('a', { hasVideo: false })], null, [])?.key).toBe('me')
  })

  it('épingle sans vidéo ignorée ; aucune vidéo : null (appel audio)', () => {
    const a = tile('a', { hasVideo: false })
    expect(mainVideoTile([a, tile('b')], 'a', [])?.key).toBe('b')
    expect(mainVideoTile([a, tile('me', { self: true, hasVideo: false })], null, ['a'])).toBeNull()
  })
})

describe('grille qui remplit l’écran', () => {
  it('une personne prend tout, deux s’empilent en portrait et se côtoient en paysage', () => {
    expect(gridShape(1, 400, 700)).toEqual({ cols: 1, cellW: 400, cellH: 700 })
    expect(gridShape(2, 400, 700).cols).toBe(1)
    expect(gridShape(2, 800, 360).cols).toBe(2)
    expect(gridShape(4, 400, 700).cols).toBe(2)
  })

  it('beaucoup de monde : cellules lisibles, défilement au-delà de 12', () => {
    const many = gridShape(30, 400, 700)
    expect(many.cols).toBeLessThanOrEqual(4)
    expect(many.cellH).toBeGreaterThan(100)
    expect(gridShape(0, 400, 700).cellW).toBe(0)
    expect(gridShape(3, 0, 700).cellW).toBe(0)
  })
})

describe('vignette déplaçable', () => {
  const frame = { W: 400, H: 800, top: 40, bottom: 120, side: 12 }
  it('s’accroche au coin le plus proche', () => {
    expect(snapToCorner(10, 10, 100, 150, frame)).toEqual({ x: 12, y: 40 })
    expect(snapToCorner(300, 30, 100, 150, frame)).toEqual({ x: 288, y: 40 })
    expect(snapToCorner(20, 700, 100, 150, frame)).toEqual({ x: 12, y: 530 })
    expect(snapToCorner(280, 600, 100, 150, frame)).toEqual({ x: 288, y: 530 })
  })
})

describe('masquage automatique des commandes', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('reste visible tant que le masquage est inactif (pas de vidéo)', () => {
    const changes: boolean[] = []
    const h = createAutoHide(CONTROLS_HIDE_MS, (v) => changes.push(v))
    jest.advanceTimersByTime(CONTROLS_HIDE_MS * 3)
    expect(h.visible).toBe(true)
    h.toggle()
    expect(h.visible).toBe(true)
    expect(changes).toEqual([])
  })

  it('se masque après le délai, réapparaît au toucher, une interaction relance le délai', () => {
    const changes: boolean[] = []
    const h = createAutoHide(1000, (v) => changes.push(v))
    h.setEnabled(true)
    jest.advanceTimersByTime(900)
    h.poke()
    jest.advanceTimersByTime(900)
    expect(h.visible).toBe(true)
    jest.advanceTimersByTime(100)
    expect(h.visible).toBe(false)
    h.toggle()
    expect(h.visible).toBe(true)
    h.toggle()
    expect(h.visible).toBe(false)
    expect(changes).toEqual([false, true, false])
  })

  it('désactivé (vidéo coupée) : réaffiche et ne masque plus ; dispose arrête le minuteur', () => {
    const h = createAutoHide(1000, () => undefined)
    h.setEnabled(true)
    jest.advanceTimersByTime(1000)
    expect(h.visible).toBe(false)
    h.setEnabled(false)
    expect(h.visible).toBe(true)
    jest.advanceTimersByTime(5000)
    expect(h.visible).toBe(true)
    h.setEnabled(true)
    h.dispose()
    jest.advanceTimersByTime(5000)
    expect(h.visible).toBe(true)
  })
})
