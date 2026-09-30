import { formatDuration, mediaKind } from '@/features/chat/media'

describe('mediaKind', () => {
  it('classe images, vidéos et audios lisibles', () => {
    expect(mediaKind({ content_type: 'image/png' })).toBe('image')
    expect(mediaKind({ content_type: 'video/mp4' })).toBe('video')
    expect(mediaKind({ content_type: 'Video/QuickTime' })).toBe('video')
    expect(mediaKind({ content_type: 'audio/mpeg' })).toBe('audio')
    expect(mediaKind({ content_type: 'audio/ogg; codecs=opus' })).toBe('audio')
    // Types produits par le serveur (mime_guess) pour .m4a et .flac
    expect(mediaKind({ content_type: 'audio/m4a' })).toBe('audio')
    expect(mediaKind({ content_type: 'audio/flac' })).toBe('audio')
  })

  it('laisse en carte « fichier » les formats non pris en charge', () => {
    expect(mediaKind({ content_type: 'video/x-msvideo' })).toBe('file')
    expect(mediaKind({ content_type: 'audio/x-ms-wma' })).toBe('file')
    expect(mediaKind({ content_type: 'application/pdf' })).toBe('file')
    expect(mediaKind({ content_type: '' })).toBe('file')
  })
})

describe('formatDuration', () => {
  it('formate minutes et heures', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(65.9)).toBe('1:05')
    expect(formatDuration(720)).toBe('12:00')
    expect(formatDuration(3723)).toBe('1:02:03')
  })

  it('tolère les valeurs invalides', () => {
    expect(formatDuration(NaN)).toBe('0:00')
    expect(formatDuration(-3)).toBe('0:00')
    expect(formatDuration(Infinity)).toBe('0:00')
  })
})
