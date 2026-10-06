import { redact } from '@/lib/logger'
import { parseInline, parseMarkdown, mentionsUser } from '@/lib/markdown'
import { parseSafeUrl, resolveMediaUrl } from '@/lib/links'
import { base64UrlDecode, readJwtExp } from '@/lib/tokens'
import { path } from '@/lib/http'
import { extractInviteCode, passwordStrength, validateRegistration } from '@/lib/validation'
import { sanitizeFilename, validateAttachment } from '@/features/chat/useConversation'

describe('logger.redact', () => {
  it('masque JWT, Bearer, refresh tokens et tickets', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcDEF123'
    expect(redact(`token ${jwt}`)).not.toContain(jwt)
    expect(redact('Authorization: Bearer abc.def.ghi')).toBe('Authorization: Bearer [redacted]')
    expect(redact({ refresh_token: 'secret123', other: 1 })).not.toContain('secret123')
    expect(redact('wss://h/ws?ticket=ABCDEF123456')).not.toContain('ABCDEF123456')
    expect(redact({ password: 'hunter2' })).not.toContain('hunter2')
  })
})

describe('markdown (rendu natif, pas de HTML)', () => {
  it('ne reconnaît que les liens http(s)', () => {
    const nodes = parseInline('clique javascript:alert(1) ou https://ok.example/page.')
    const links = nodes.filter((n) => n.t === 'link')
    expect(links).toEqual([{ t: 'link', url: 'https://ok.example/page' }])
  })
  it('laisse le HTML en texte brut', () => {
    const blocks = parseMarkdown('<img src=x onerror=alert(1)>')
    expect(blocks).toEqual([{ t: 'para', c: [{ t: 'text', v: '<img src=x onerror=alert(1)>' }] }])
  })
  it('gère gras, code, spoiler, citation et blocs de code', () => {
    const blocks = parseMarkdown('**gras** `code` ||secret||\n> cité\n```js\nconst a = 1\n```')
    expect(blocks[0]).toMatchObject({ t: 'para' })
    expect(blocks.some((b) => b.t === 'quote')).toBe(true)
    expect(blocks.find((b) => b.t === 'codeblock')).toEqual({ t: 'codeblock', lang: 'js', v: 'const a = 1' })
  })
  it('borne la profondeur et la taille (anti-DoS)', () => {
    const deep = '**'.repeat(200) + 'x' + '**'.repeat(200)
    expect(() => parseMarkdown(deep)).not.toThrow()
    const huge = 'a'.repeat(100_000)
    const out = parseMarkdown(huge)
    expect((out[0] as { c: { v: string }[] }).c[0]!.v.length).toBeLessThanOrEqual(6000)
  })
  it('détecte les mentions', () => {
    expect(mentionsUser('salut @Alice', 'u1', 'alice')).toBe(true)
    expect(mentionsUser('salut @Alicette', 'u1', 'alice')).toBe(false)
    expect(mentionsUser('<@u1> hey', 'u1', 'x')).toBe(true)
    expect(mentionsUser('@everyone', 'u1', 'x')).toBe(true)
  })
})

describe('URL sûres', () => {
  it('refuse les schémas dangereux et les identifiants dans l’URL', () => {
    expect(parseSafeUrl('javascript:alert(1)')).toBeNull()
    expect(parseSafeUrl('file:///etc/passwd')).toBeNull()
    expect(parseSafeUrl('intent://scan/#Intent;scheme=zxing;end')).toBeNull()
    expect(parseSafeUrl('https://paypal.com@evil.tld/')).toBeNull()
    expect(parseSafeUrl('https://ok.example/a?b=1')?.host).toBe('ok.example')
  })
  it('résout les médias relatifs du serveur sans traversée', () => {
    expect(resolveMediaUrl('/uploads/abc.png')).toMatch(/^https:\/\/.+\/uploads\/abc\.png$/)
    expect(resolveMediaUrl('/uploads/../secret')).toBeNull()
    expect(resolveMediaUrl('data:text/html,<script>')).toBeNull()
    expect(resolveMediaUrl(null)).toBeNull()
  })
})

describe('JWT / base64url', () => {
  it('décode l’exp d’un JWT', () => {
    const payload = Buffer.from(JSON.stringify({ sub: 'x', exp: 1893456000, name: 'Élodie 🚀' })).toString('base64url')
    expect(readJwtExp(`h.${payload}.s`)).toBe(1893456000)
    expect(JSON.parse(base64UrlDecode(payload)).name).toBe('Élodie 🚀')
  })
  it('résiste aux entrées invalides', () => {
    expect(readJwtExp('pas-un-jwt')).toBe(0)
    expect(readJwtExp('a.%%%.b')).toBe(0)
  })
})

describe('path`` (anti injection de chemin)', () => {
  it('encode chaque segment', () => {
    expect(path`/dms/${'a/b?c'}/messages`).toBe('/dms/a%2Fb%3Fc/messages')
    expect(path`/r/${'👍'}`).toBe('/r/%F0%9F%91%8D')
  })
  it('refuse les segments vides ou de traversée', () => {
    expect(() => path`/x/${'..'}`).toThrow()
    expect(() => path`/x/${''}`).toThrow()
  })
})

describe('validation', () => {
  it('valide l’inscription', () => {
    expect(validateRegistration({ username: 'ok_user', email: 'a@b.fr', password: 'Str0ng!Passw', confirm: 'Str0ng!Passw' })).toEqual({})
    const e = validateRegistration({ username: 'x', email: 'nope', password: 'short', confirm: 'diff' })
    expect(Object.keys(e).sort()).toEqual(['confirm', 'email', 'password', 'username'])
  })
  it('note la robustesse des mots de passe', () => {
    expect(passwordStrength('password123').score).toBeLessThanOrEqual(1)
    expect(passwordStrength('Tr0ub4dor&3xyz').score).toBeGreaterThanOrEqual(3)
  })
  it('extrait les codes d’invitation', () => {
    expect(extractInviteCode('https://forgechat.heiphaistos.org/invite/AbC_12')).toBe('AbC_12')
    expect(extractInviteCode('AbC-12')).toBe('AbC-12')
    expect(extractInviteCode('../../etc')).toBeNull()
    expect(extractInviteCode('code avec espace')).toBeNull()
  })
})

describe('pièces jointes', () => {
  it('nettoie les noms de fichiers', () => {
    expect(sanitizeFilename('../../evil/../photo.jpg')).toBe('photo.jpg')
    expect(sanitizeFilename('C:\\Users\\x\\doc<1>.pdf')).toBe('doc_1_.pdf')
    expect(sanitizeFilename('...hidden')).toBe('hidden')
    expect(sanitizeFilename('')).toBe('fichier')
  })
  it('refuse extensions interdites et tailles excessives', () => {
    expect(validateAttachment({ uri: 'file://a', name: 'a.exe', type: 'x', size: 10 })).toMatch(/non autorisé/)
    expect(validateAttachment({ uri: 'file://a', name: 'a.jpg', type: 'image/jpeg', size: 60 * 1024 * 1024 })).toMatch(/volumineux/)
    expect(validateAttachment({ uri: 'file://a', name: 'a.jpg', type: 'image/jpeg', size: 1000 })).toBeNull()
  })
})
