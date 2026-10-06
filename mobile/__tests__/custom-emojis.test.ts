import { buildEmojiMap, reactionEmojiName, safeEmojiUrl } from '@/features/chat/customEmojis'
import { parseInline } from '@/lib/markdown'

describe('safeEmojiUrl', () => {
  it('accepte /uploads/ (résolu sur le serveur) et https', () => {
    expect(safeEmojiUrl('/uploads/emojis/emoji_1.png')).toMatch(/^https?:\/\/[^/]+\/uploads\/emojis\/emoji_1\.png$/)
    expect(safeEmojiUrl('https://static1.klipy.com/e.gif')).toBe('https://static1.klipy.com/e.gif')
    // Hôte quelconque refusé : pixel espion (IP des membres).
    expect(safeEmojiUrl('https://cdn.example.org/e.gif')).toBeNull()
  })

  it('refuse tout le reste', () => {
    for (const bad of [
      'http://cdn.example.org/e.png',
      'data:image/png;base64,AAAA',
      'javascript:alert(1)',
      'file:///etc/passwd',
      '/uploads/../secrets.png',
      '/uploads/emojis/x.png?redirect=https://evil',
      '/uploads\\..\\x.png',
      '/api/users/me',
      '//evil.example/e.png',
      'https://user:pass@evil.example/e.png',
      '',
      null,
      42,
    ]) {
      expect(safeEmojiUrl(bad)).toBeNull()
    }
  })
})

describe('buildEmojiMap', () => {
  it('garde les entrées valides, ignore noms et URL refusés, premier arrivé gagne', () => {
    const map = buildEmojiMap([
      { id: '1', name: 'party', url: '/uploads/emojis/a.png', animated: false },
      { id: '2', name: 'party', url: '/uploads/emojis/b.png', animated: false },
      { id: '3', name: 'bad name', url: '/uploads/emojis/c.png', animated: false },
      { id: '4', name: 'evil', url: 'javascript:alert(1)', animated: false },
      { id: '5', name: 'x'.repeat(33), url: '/uploads/emojis/d.png', animated: false },
      null,
    ])
    expect([...map.keys()]).toEqual(['party'])
    expect(map.get('party')).toMatch(/a\.png$/)
    expect(buildEmojiMap('pas un tableau').size).toBe(0)
  })
})

describe('reactionEmojiName', () => {
  it('reconnaît « :nom: » et laisse les emojis Unicode', () => {
    expect(reactionEmojiName(':party:')).toBe('party')
    expect(reactionEmojiName('🎉')).toBeNull()
    expect(reactionEmojiName(':a b:')).toBeNull()
    expect(reactionEmojiName('party')).toBeNull()
  })
})

describe('markdown : « :nom: »', () => {
  it('produit un nœud emoji', () => {
    expect(parseInline('salut :party: !')).toEqual([
      { t: 'text', v: 'salut ' },
      { t: 'emoji', v: 'party' },
      { t: 'text', v: ' !' },
    ])
  })

  it('ne touche pas au code ni aux liens', () => {
    expect(parseInline('`:party:`')).toEqual([{ t: 'code', v: ':party:' }])
    expect(parseInline('https://ex.org/a:b:c')).toEqual([{ t: 'link', url: 'https://ex.org/a:b:c' }])
  })
})
