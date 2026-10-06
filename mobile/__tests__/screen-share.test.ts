import {
  callShareUnavailableReason,
  canShareInCall,
  clampOffset,
  clampZoom,
  isScreenShareCancel,
  ZOOM_MAX,
} from '@/features/calls/screenShareLogic'

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
    // Forme réelle : MediaStreamError de la pile WebRTC (objet simple, pas une Error).
    expect(isScreenShareCancel({ name: 'DOMException', message: 'NotAllowedError' })).toBe(true)
    expect(isScreenShareCancel({ name: 'Error', message: 'ScreenTrack is null.' })).toBe(false)
    expect(isScreenShareCancel(null)).toBe(false)
  })
})
