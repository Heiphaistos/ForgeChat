import { useUi } from '@/stores/ui'
import { useUnread } from '@/stores/unread'

/**
 * Navigation dans un serveur (accueil façon Discord) : panneau du salon, catégories repliées,
 * mentions par salon pour la pastille rouge.
 */

describe('panneau du salon et catégories', () => {
  beforeEach(() => useUi.setState({ selectedServerId: null, chatOpen: false, collapsed: {} }))

  it('changer de serveur referme le salon ouvert (sa liste de salons s’affiche)', () => {
    useUi.getState().selectServer('s1')
    useUi.getState().setChatOpen(true)
    useUi.getState().selectServer('s2')
    expect(useUi.getState()).toMatchObject({ selectedServerId: 's2', chatOpen: false })
  })

  it('replie puis déplie une catégorie', () => {
    // Catégorie affichée dépliée → repliée, puis l'inverse : le choix explicite est retenu.
    useUi.getState().toggleCategory('c1', false)
    expect(useUi.getState().collapsed).toEqual({ c1: true })
    useUi.getState().toggleCategory('c1', true)
    expect(useUi.getState().collapsed).toEqual({ c1: false })
  })
})

describe('mentions par salon', () => {
  beforeEach(() => useUnread.getState().reset())

  it('lit mention_count (salons seulement), ajoute les nouvelles, efface à la lecture', () => {
    useUnread.getState().load([
      { channel_id: 'a', server_id: 's', count: 3, mention_count: 1 },
      { channel_id: 'b', server_id: 's', count: 2, mention_count: 0 },
      { channel_id: 'dm', server_id: null, count: 4, mention_count: 4 },
    ])
    expect(useUnread.getState().mentions).toEqual({ a: 1 })
    useUnread.getState().addMention('b')
    expect(useUnread.getState().mentions).toEqual({ a: 1, b: 1 })
    useUnread.getState().clear('a')
    expect(useUnread.getState().mentions).toEqual({ b: 1 })
    expect(useUnread.getState().counts.a).toBeUndefined()
  })

  it('salon affiché : ni non-lu ni mention', () => {
    useUnread.getState().setActive('a')
    useUnread.getState().addMention('a')
    expect(useUnread.getState().mentions).toEqual({})
  })
})
