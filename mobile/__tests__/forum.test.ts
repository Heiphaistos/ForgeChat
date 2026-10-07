import { createPostBody, isVideoMedia, mediaExtension, MAX_TAGS, nextPostsCursor, normalizePost, normalizePosts, normalizeTag, toggleTag } from '@/features/forum/forum'

const A = '3af17b11-1c9a-4daf-8895-a2d3eec03894'
const B = '5aa172f3-305c-4685-bd77-64faf6b911eb'

const raw = {
  id: A,
  channel_id: B,
  title: 'Bienvenue',
  content: 'Présentez-vous',
  creator_id: B,
  creator_username: 'alice',
  creator_avatar: null,
  tags: ['aide', 3, 'news'],
  pinned: true,
  locked: false,
  reply_count: 4,
  last_reply_at: '2026-10-02T10:00:00Z',
  created_at: '2026-10-01T10:00:00Z',
}

describe('normalizePost (forum.rs::list_posts / get_post)', () => {
  it('lit une publication, garde les tags texte, activité = dernière réponse', () => {
    expect(normalizePost(raw)).toEqual({
      id: A,
      title: 'Bienvenue',
      content: 'Présentez-vous',
      creatorId: B,
      creatorName: 'alice',
      creatorAvatar: null,
      tags: ['aide', 'news'],
      pinned: true,
      locked: false,
      replyCount: 4,
      lastActivity: '2026-10-02T10:00:00Z',
      mediaUrl: null,
      clientMsgId: null,
    })
  })

  it('salon média : garde un média /uploads/, ignore toute autre URL', () => {
    expect(normalizePost({ ...raw, media_url: '/uploads/a.png' })?.mediaUrl).toBe('/uploads/a.png')
    expect(normalizePost({ ...raw, media_url: 'https://x.test/a.png' })?.mediaUrl).toBeNull()
    expect(isVideoMedia('/uploads/a.MP4')).toBe(true)
    expect(isVideoMedia('/uploads/a.webp')).toBe(false)
    expect(mediaExtension('video/quicktime')).toBe('mov')
    expect(mediaExtension('image/JPEG')).toBe('jpg')
    expect(mediaExtension('application/pdf')).toBeNull()
    expect(mediaExtension(undefined)).toBeNull()
  })

  it('get_post ne renvoie pas last_reply_at : activité = création', () => {
    const { last_reply_at: _omit, ...detail } = raw
    expect(normalizePost(detail)?.lastActivity).toBe('2026-10-01T10:00:00Z')
  })

  it('ignore les entrées invalides', () => {
    expect(normalizePosts([raw, { ...raw, id: 'x' }, { ...raw, title: null }, null])).toHaveLength(1)
    expect(normalizePosts({})).toEqual([])
  })
})

describe('tags', () => {
  it('mis en forme comme le web', () => {
    expect(normalizeTag('  Aide Rapide ')).toBe('aide-rapide')
  })

  it('ajout, retrait, sans doublon, 5 au plus', () => {
    expect(toggleTag([], 'Aide')).toEqual(['aide'])
    expect(toggleTag(['aide'], 'aide')).toEqual([])
    expect(toggleTag(['a'], '   ')).toEqual(['a'])
    const full = ['a', 'b', 'c', 'd', 'e']
    expect(full).toHaveLength(MAX_TAGS)
    expect(toggleTag(full, 'f')).toBe(full)
  })
})

describe('createPostBody (forum.rs::CreatePostReq)', () => {
  it('titre obligatoire (200 max), contenu vide omis', () => {
    expect(createPostBody(' Titre ', '  ', ['aide'])).toEqual({ title: 'Titre', content: undefined, tags: ['aide'] })
    expect(createPostBody('T', ' corps ', [])).toEqual({ title: 'T', content: 'corps', tags: [] })
    expect(createPostBody('   ', 'x', [])).toBeNull()
    expect(createPostBody('x'.repeat(201), '', [])).toBeNull()
    expect(createPostBody('é'.repeat(200), '', [])).not.toBeNull()
    expect(createPostBody('T', '', [], '/uploads/a.png')?.media_url).toBe('/uploads/a.png')
  })
})

describe('pagination des publications', () => {
  it('curseur = dernière publication d’une page pleine', () => {
    const page = normalizePosts([raw, { ...raw, id: B }])
    expect(nextPostsCursor(page, 2)).toBe(B)
    expect(nextPostsCursor(page, 3)).toBeUndefined()
  })
})
