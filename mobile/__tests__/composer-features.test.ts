import { ALLOWED_UPLOAD_EXTENSIONS } from '@/config/env'
import { DEFAULT_QUICK_REPLIES, EMOJI_CATEGORIES, GLOBAL_STICKERS, MESSAGE_TTL_OPTIONS, RECENT_EMOJIS_MAX } from '@/features/composer/data'
import {
  formatSticker,
  isExpired,
  isVoiceAttachment,
  isVoiceMessageText,
  nextExpiry,
  parseSticker,
  remainingLabel,
  tenorGifUrl,
  VOICE_MAX_SECONDS,
  voiceFileName,
  voiceMessageContent,
} from '@/features/composer/formats'
import { parseServerStickers } from '@/features/composer/stickers'
import { normalizeQuickReplies, pushRecent, QUICK_REPLY_LIMITS } from '@/features/composer/store'

/**
 * Barre de saisie (emoji, GIF, stickers, réponses rapides, expiration, vocaux) : mêmes formats que
 * le client web de Heiphaistos (commit 2dae54d), pour qu'un message envoyé d'un côté s'affiche de
 * l'autre.
 */

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }))

describe('emoji', () => {
  it('mêmes 8 catégories que le web, 18 récents au plus', () => {
    expect(EMOJI_CATEGORIES.map((c) => c.label)).toEqual([
      '😀 Smileys', '👋 Gestes', '❤️ Cœurs', '🐶 Animaux', '🍎 Nourriture', '⚽ Sports', '🌍 Nature', '🚗 Objets',
    ])
    expect(EMOJI_CATEGORIES.every((c) => c.emojis.length > 20)).toBe(true)
    expect(RECENT_EMOJIS_MAX).toBe(18)
  })

  it('récents : le dernier utilisé en tête, sans doublon, borné', () => {
    expect(pushRecent(['😀', '🔥'], '🔥')).toEqual(['🔥', '😀'])
    const many = Array.from({ length: 30 }, (_, i) => String(i))
    expect(pushRecent(many, 'x')).toHaveLength(RECENT_EMOJIS_MAX)
  })
})

describe('stickers (format web : sticker-utils.ts)', () => {
  it('sticker emoji et sticker image : aller-retour identique au web', () => {
    expect(formatSticker({ name: 'cat', emoji: '🐱' })).toBe('[sticker:🐱:cat]')
    expect(formatSticker({ name: 'logo', url: '/uploads/stickers/a.png' })).toBe('[sticker:logo](/uploads/stickers/a.png)')
    expect(parseSticker('[sticker:🐱:cat]')).toEqual({ emoji: '🐱', name: 'cat' })
    expect(parseSticker('[sticker:logo](/uploads/stickers/a.png)')).toEqual({ name: 'logo', url: '/uploads/stickers/a.png' })
  })

  it('un texte normal n’est pas un sticker', () => {
    for (const t of ['salut', '[sticker:🐱:cat] et du texte', 'voir [sticker:x](y)', '', null]) expect(parseSticker(t)).toBeNull()
  })

  it('20 stickers globaux du web, chacun reconnu après envoi', () => {
    expect(GLOBAL_STICKERS).toHaveLength(20)
    for (const s of GLOBAL_STICKERS) expect(parseSticker(formatSticker(s))).toEqual({ emoji: s.emoji, name: s.name })
  })

  it('stickers du serveur : seules les URL du serveur ou https sont affichées', () => {
    const list = parseServerStickers([
      { id: '1', name: 'ok', url: '/uploads/stickers/ok.png' },
      { id: '2', name: 'http', url: 'http://exemple.invalid/x.png' },
      { id: '3', name: 'js', url: 'javascript:alert(1)' },
      { id: '4', name: 'parenthèse', url: '/uploads/stickers/a).png' },
      { id: '5', name: 'remonte', url: '/uploads/../secret' },
      { id: 6, name: 'id', url: '/uploads/stickers/b.png' },
    ])
    expect(list.map((s) => s.name)).toEqual(['ok'])
    expect(list[0]!.url).toBe('/uploads/stickers/ok.png')
    expect(list[0]!.src).toBe('https://chat.example.org/uploads/stickers/ok.png')
    expect(parseServerStickers({})).toEqual([])
  })
})

describe('GIF (envoyés par le web depuis Tenor)', () => {
  it('reconnaît un message qui n’est que l’URL d’un GIF Tenor', () => {
    expect(tenorGifUrl('https://media.tenor.com/7-yVpYFh4qMAAAAC/hello-hi.gif')).toBe('https://media.tenor.com/7-yVpYFh4qMAAAAC/hello-hi.gif')
    expect(tenorGifUrl(' https://media1.tenor.com/m/abc_DEF/x.gif ')).toBe('https://media1.tenor.com/m/abc_DEF/x.gif')
  })

  it('aucun autre hôte, protocole ou texte : jamais chargé comme image', () => {
    for (const t of [
      'http://media.tenor.com/a/b.gif',
      'https://media.tenor.com.evil.invalid/a/b.gif',
      'https://evil.invalid/media.tenor.com/a/b.gif',
      'https://media.tenor.com/a/b.png',
      'regarde https://media.tenor.com/a/b.gif',
      'https://media.tenor.com/a/b.gif?x=1',
      '😀 Heureux',
    ])
      expect(tenorGifUrl(t)).toBeNull()
  })
})

describe('réponses rapides (sur l’appareil, comme le web)', () => {
  it('par défaut : les 3 réponses du web', () => {
    expect(DEFAULT_QUICK_REPLIES.map((r) => r.label)).toEqual(['Merci', 'OK', 'Bientôt'])
    expect(normalizeQuickReplies([])).toEqual(DEFAULT_QUICK_REPLIES)
  })

  it('nettoyage : vides retirés, champs tronqués, 10 au plus, nom déduit du texte', () => {
    const out = normalizeQuickReplies([
      { id: 'a', label: '  ', content: 'Bonjour à tous' },
      { id: 'b', label: 'vide', content: '   ' },
      { id: 'c', label: 'x'.repeat(100), content: 'y'.repeat(1000) },
      ...Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, label: `n${i}`, content: `t${i}` })),
    ])
    expect(out).toHaveLength(QUICK_REPLY_LIMITS.count)
    expect(out[0]).toEqual({ id: 'a', label: 'Bonjour à tous', content: 'Bonjour à tous' })
    expect(out[1]!.label).toHaveLength(QUICK_REPLY_LIMITS.label)
    expect(out[1]!.content).toHaveLength(QUICK_REPLY_LIMITS.content)
    expect(out.some((r) => r.label === 'vide')).toBe(false)
  })
})

describe('expiration (serveur : expires_at, purge chaque minute)', () => {
  it('mêmes choix que le web, en secondes', () => {
    expect(MESSAGE_TTL_OPTIONS.map((o) => o.seconds)).toEqual([null, 300, 3600, 86400, 604800])
  })

  it('expiré / prochaine expiration / temps restant', () => {
    const now = Date.parse('2026-10-05T12:00:00Z')
    expect(isExpired('2026-10-05T11:59:59Z', now)).toBe(true)
    expect(isExpired('2026-10-05T12:05:00Z', now)).toBe(false)
    expect(isExpired(null, now)).toBe(false)
    expect(isExpired('pas une date', now)).toBe(false)
    expect(nextExpiry([{ expiresAt: null }, { expiresAt: '2026-10-05T13:00:00Z' }, { expiresAt: '2026-10-05T12:05:00Z' }, { expiresAt: '2026-10-05T11:00:00Z' }], now)).toBe(
      Date.parse('2026-10-05T12:05:00Z'),
    )
    expect(nextExpiry([{}, { expiresAt: null }], now)).toBeNull()
    expect(remainingLabel('2026-10-05T12:04:10Z', now)).toBe('5 min')
    expect(remainingLabel('2026-10-05T14:00:00Z', now)).toBe('2 h')
    expect(remainingLabel('2026-10-08T12:00:00Z', now)).toBe('3 j')
  })
})

describe('messages vocaux', () => {
  it('même texte que le web, 2 minutes au plus', () => {
    expect(voiceMessageContent(5)).toBe('🎤 Message vocal (0:05)')
    expect(voiceMessageContent(65.4)).toBe('🎤 Message vocal (1:05)')
    expect(voiceMessageContent(120)).toBe('🎤 Message vocal (2:00)')
    expect(VOICE_MAX_SECONDS).toBe(120)
    expect(isVoiceMessageText('🎤 Message vocal (1:05)')).toBe(true)
    expect(isVoiceMessageText('🎤 Message vocal (1:05) lol')).toBe(false)
  })

  it('fichier de l’app : .mp4 (accepté par le serveur, qui refuse .m4a)', () => {
    const name = voiceFileName(1_760_000_000_000)
    expect(name).toBe('voice-1760000000000.mp4')
    expect(ALLOWED_UPLOAD_EXTENSIONS.has('mp4')).toBe(true)
    expect(ALLOWED_UPLOAD_EXTENSIONS.has('m4a')).toBe(false)
  })

  it('vocaux du web (.webm typé vidéo, .ogg) et de l’app (.mp4) lus avec le lecteur audio', () => {
    expect(isVoiceAttachment({ filename: 'voice-1760000000000.webm', content_type: 'video/webm' })).toBe(true)
    expect(isVoiceAttachment({ filename: 'voice-1760000000000.ogg', content_type: 'audio/ogg' })).toBe(true)
    expect(isVoiceAttachment({ filename: 'voice-1760000000000.mp4', content_type: 'video/mp4' })).toBe(true)
    expect(isVoiceAttachment({ filename: 'vacances.mp4', content_type: 'video/mp4' })).toBe(false)
    expect(isVoiceAttachment({ filename: 'voice-1760000000000.pdf', content_type: 'application/pdf' })).toBe(false)
  })
})

describe('envoi d’un message éphémère (protocole du serveur)', () => {
  const post = jest.fn().mockResolvedValue({ id: 'm1', content: 'x', created_at: '2026-10-05T12:00:00Z', author_id: 'u', author_username: 'u' })
  beforeAll(() => {
    jest.resetModules()
    jest.doMock('@/lib/http', () => ({ http: { post: (...a: unknown[]) => post(...a) }, path: (s: TemplateStringsArray, ...v: string[]) => s.reduce((acc, p, i) => acc + p + (v[i] ?? ''), '') }))
  })
  afterAll(() => jest.dontMock('@/lib/http'))

  it('salon : expires_at_seconds envoyé ; message privé et groupe : jamais (non géré par le serveur)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { messagesApi } = require('@/api/messages') as typeof import('@/api/messages')
    await messagesApi.send({ kind: 'channel', serverId: 's', channelId: 'c' }, { content: 'x', expiresInSeconds: 300 })
    expect(post.mock.calls[0]![1]).toMatchObject({ content: 'x', expires_at_seconds: 300 })
    await messagesApi.send({ kind: 'channel', serverId: 's', channelId: 'c' }, { content: 'x', expiresInSeconds: null })
    expect(post.mock.calls[1]![1]).not.toHaveProperty('expires_at_seconds')
    await messagesApi.send({ kind: 'dm', dmId: 'd' }, { content: 'x', expiresInSeconds: 300 }).catch(() => undefined)
    await messagesApi.send({ kind: 'group', groupId: 'g' }, { content: 'x', expiresInSeconds: 300 }).catch(() => undefined)
    for (const call of post.mock.calls.slice(2)) expect(call[1]).not.toHaveProperty('expires_at_seconds')
  })
})
