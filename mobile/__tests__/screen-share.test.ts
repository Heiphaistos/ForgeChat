import {
  callShareUnavailableReason,
  canShareInCall,
  clampOffset,
  clampZoom,
  classifyIncomingTrack,
  isScreenShareCancel,
  ZOOM_MAX,
} from '@/features/calls/screenShareLogic'

describe('partage d’écran : tri des pistes reçues (protocole du client web)', () => {
  it('le 1er flux vu devient la référence micro+caméra', () => {
    expect(classifyIncomingTrack(undefined, 'cam', 'audio')).toEqual({ isScreen: false, camStreamId: 'cam' })
    expect(classifyIncomingTrack(undefined, 'cam', 'video')).toEqual({ isScreen: false, camStreamId: 'cam' })
  })
  it('une vidéo d’un autre flux est l’écran partagé', () => {
    expect(classifyIncomingTrack('cam', 'ecran', 'video')).toEqual({ isScreen: true, camStreamId: 'cam' })
  })
  it('la caméra du même flux reste la caméra ; l’audio n’est jamais l’écran', () => {
    expect(classifyIncomingTrack('cam', 'cam', 'video').isScreen).toBe(false)
    expect(classifyIncomingTrack('cam', 'autre', 'audio').isScreen).toBe(false)
  })
})

describe('partage d’écran en appel 1:1', () => {
  it('seulement en appel vidéo établi', () => {
    expect(canShareInCall('connected', 'video')).toBe(true)
    expect(canShareInCall('connected', 'voice')).toBe(false)
    expect(canShareInCall('connecting', 'video')).toBe(false)
    expect(callShareUnavailableReason('connected', 'voice')).toMatch(/appel vidéo/)
    expect(callShareUnavailableReason('calling', 'video')).toMatch(/établi/)
    expect(callShareUnavailableReason('connected', 'video')).toBeNull()
  })
})

describe('visionneuse : zoom au pincement', () => {
  it('borne le facteur de zoom', () => {
    expect(clampZoom(0.4)).toBe(1)
    expect(clampZoom(2.5)).toBe(2.5)
    expect(clampZoom(40)).toBe(ZOOM_MAX)
    expect(clampZoom(Number.NaN)).toBe(1)
  })
  it('garde la vue agrandie dans le cadre', () => {
    expect(clampOffset(50, 2, 400)).toBe(0)
    expect(clampOffset(-100, 2, 400)).toBe(-100)
    expect(clampOffset(-900, 2, 400)).toBe(-400)
    expect(clampOffset(-10, 1, 400)).toBe(0)
  })
})

describe('refus du dialogue système', () => {
  it('reconnaît un refus ou une annulation, pas une vraie erreur', () => {
    const rnErr = Object.assign(new Error('NotAllowedError'), { code: 'DOMException' })
    expect(isScreenShareCancel(rnErr)).toBe(true)
    expect(isScreenShareCancel(new Error('AbortError'))).toBe(true)
    expect(isScreenShareCancel(new Error('ScreenTrack is null.'))).toBe(false)
    expect(isScreenShareCancel('NotAllowedError')).toBe(true)
    // Forme réelle : MediaStreamError de react-native-webrtc (objet simple, pas une Error).
    expect(isScreenShareCancel({ name: 'DOMException', message: 'NotAllowedError' })).toBe(true)
    expect(isScreenShareCancel({ name: 'Error', message: 'ScreenTrack is null.' })).toBe(false)
    expect(isScreenShareCancel(null)).toBe(false)
  })
})
