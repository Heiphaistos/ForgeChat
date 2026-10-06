import { formatTimestamp, parseInline, parseMarkdown, previewUrl } from '@/lib/markdown'

const ID = '0f8c2b1e-1234-4abc-9def-0123456789ab'

describe('parseInline (parité web)', () => {
  it('souligné, italique _ et gras italique', () => {
    expect(parseInline('__a__ _b_ ***c***')).toEqual([
      { t: 'underline', c: [{ t: 'text', v: 'a' }] },
      { t: 'text', v: ' ' },
      { t: 'italic', c: [{ t: 'text', v: 'b' }] },
      { t: 'text', v: ' ' },
      { t: 'bold', c: [{ t: 'italic', c: [{ t: 'text', v: 'c' }] }] },
    ])
  })
  it('laisse les identifiants à tirets bas en texte', () => {
    expect(parseInline('max_retries_value et snake__case__x')).toEqual([{ t: 'text', v: 'max_retries_value et snake__case__x' }])
  })
  it('liens masqués http(s) uniquement', () => {
    expect(parseInline('[doc](https://ex.org/a)')).toEqual([{ t: 'link', url: 'https://ex.org/a', label: 'doc' }])
    expect(parseInline('[x](javascript:alert(1))').some((n) => n.t === 'link')).toBe(false)
  })
  it('jetons : rôle, membre, salon, horodatage, emoji distant', () => {
    expect(parseInline(`<@&${ID}>`)).toEqual([{ t: 'role', id: ID }])
    expect(parseInline(`<@!${ID.toUpperCase()}>`)).toEqual([{ t: 'mention', v: ID, everyone: false }])
    expect(parseInline(`<#${ID}>`)).toEqual([{ t: 'channel', id: ID }])
    expect(parseInline('<t:1700000000:R>')).toEqual([{ t: 'time', unix: 1700000000, fmt: 'R' }])
    expect(parseInline(`<a:Party_1:${ID}> <:ok:${ID}>`)).toEqual([
      { t: 'remoteEmoji', id: ID, name: 'Party_1' },
      { t: 'text', v: ' ' },
      { t: 'remoteEmoji', id: ID, name: 'ok' },
    ])
  })
  it('format inconnu ou identifiant invalide : texte brut', () => {
    expect(parseInline('<t:soon> <#abc> <@&x>')).toEqual([{ t: 'text', v: '<t:soon> <#abc> <@&x>' }])
  })
})

describe('parseMarkdown', () => {
  it('titres #, ##, ### en début de ligne seulement', () => {
    const blocks = parseMarkdown('# Grand\n## **Moyen**\n### Petit\nphrase # pas titre\n#collé')
    expect(blocks.slice(0, 3)).toEqual([
      { t: 'heading', level: 1, c: [{ t: 'text', v: 'Grand' }] },
      { t: 'heading', level: 2, c: [{ t: 'bold', c: [{ t: 'text', v: 'Moyen' }] }] },
      { t: 'heading', level: 3, c: [{ t: 'text', v: 'Petit' }] },
    ])
    expect(blocks[3]).toEqual({ t: 'para', c: [{ t: 'text', v: 'phrase # pas titre\n#collé' }] })
  })
})

describe('formatTimestamp', () => {
  const at = new Date(2026, 9, 7, 14, 5, 9).getTime()
  const unix = at / 1000
  it('formats absolus en heure locale', () => {
    expect(formatTimestamp(unix, 'd')).toBe('07/10/2026')
    expect(formatTimestamp(unix, 'D')).toBe('7 oct. 2026')
    expect(formatTimestamp(unix, 't')).toBe('14:05')
    expect(formatTimestamp(unix, 'T')).toBe('14:05:09')
    expect(formatTimestamp(unix, 'f')).toBe('7 oct. 2026 14:05')
    expect(formatTimestamp(unix, 'F')).toBe('mercredi 7 oct. 2026 14:05')
  })
  it('relatif comme le web', () => {
    expect(formatTimestamp(unix, 'R', at + 30_000)).toBe("à l'instant")
    expect(formatTimestamp(unix, 'R', at + 5 * 60_000)).toBe('il y a 5 minutes')
    expect(formatTimestamp(unix, 'r', at - 3_600_000)).toBe('dans 1 heure')
    expect(formatTimestamp(unix, 'R', at + 2 * 86_400_000)).toBe('il y a 2 jours')
  })
})

describe('previewUrl', () => {
  it('premier lien hors code, spoiler et médias', () => {
    expect(previewUrl('voir https://ex.org/page.')).toBe('https://ex.org/page')
    expect(previewUrl('`https://code.org` [doc](https://doc.org/x)')).toBe('https://doc.org/x')
    expect(previewUrl('||https://cache.org|| rien')).toBeNull()
    expect(previewUrl('https://ex.org/chat.GIF')).toBeNull()
    expect(previewUrl('```\nhttps://code.org\n```')).toBeNull()
    expect(previewUrl(null)).toBeNull()
  })
})
