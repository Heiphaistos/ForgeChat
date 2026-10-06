import builtin from '@/features/servers/builtinServerTemplates.json'
import {
  builtinTemplates,
  parseRemoteTemplates,
  parseTemplateData,
  planBuiltinCreation,
  serverNameError,
  templatePreview,
  utf8Length,
} from '@/features/servers/templates'

describe('modèles de serveur intégrés (repris du web)', () => {
  it('mêmes modèles que le web, dans le même ordre', () => {
    expect(builtin.source).toMatch(/ServerSidebar\.tsx \(BUILTIN_TEMPLATES\)/)
    expect(builtinTemplates.map((t) => t.name)).toEqual(['Gaming', 'Communauté', 'Étude', 'Team'])
    expect(builtinTemplates.every((t) => t.source === 'builtin' && t.data.channels.length > 0)).toBe(true)
  })

  it('aperçu : salons sans catégorie d’abord, puis chaque catégorie dans l’ordre', () => {
    const community = builtinTemplates.find((t) => t.name === 'Communauté')!
    const p = templatePreview(community.data)
    expect(p.sections.map((s) => s.title)).toEqual([null, 'Info', 'Discussion'])
    expect(p.sections[0]!.channels.map((c) => c.name)).toEqual(['Salon principal'])
    expect(p.sections[1]!.channels.map((c) => c.name)).toEqual(['accueil', 'règles'])
    expect(p.channelCount).toBe(5)
  })

  it('plan de création : catégories puis salons, remplacement du « général » par défaut', () => {
    const gaming = builtinTemplates.find((t) => t.name === 'Gaming')!
    const plan = planBuiltinCreation(gaming.data)
    expect(plan.categories.map((c) => c.name)).toEqual(['Texte', 'Vocal'])
    expect(plan.channels[0]).toEqual({ name: 'général', type: 'text', categoryKey: '__cat1__' })
    expect(plan.channels.find((c) => c.name === 'AFK')).toEqual({ name: 'AFK', type: 'voice', categoryKey: '__cat2__' })
    expect(plan.replaceDefaultGeneral).toBe(true)
    expect(planBuiltinCreation({ categories: [], channels: [{ name: 'Lobby', type: 'voice' }], roles: [] }).replaceDefaultGeneral).toBe(false)
  })
})

describe('modèles partagés (GET /templates)', () => {
  it('sépare publics et miens, avec une description par défaut comme le web', () => {
    const r = parseRemoteTemplates({
      public: [{ id: 't1', name: 'Club', description: null, usage_count: 3, template_data: { channels: [{ name: 'a', type: 'text' }] } }],
      mine: [{ id: 't2', name: 'Perso', description: 'à moi', template_data: {} }],
    })
    expect(r.public).toEqual([expect.objectContaining({ id: 't1', name: 'Club', description: 'Utilisé 3 fois', source: 'public' })])
    expect(r.mine[0]).toEqual(expect.objectContaining({ id: 't2', description: 'à moi', source: 'mine' }))
  })

  it('ignore les données invalides au lieu de planter', () => {
    expect(parseRemoteTemplates(null)).toEqual({ public: [], mine: [] })
    expect(parseRemoteTemplates({ public: [{ name: 'sans id' }, 42, null] }).public).toEqual([])
    const d = parseTemplateData({ channels: [{ name: '' }, { type: 'voice' }, { name: 'ok' }], roles: 'x', categories: [{}] })
    expect(d).toEqual({ categories: [], channels: [{ id: undefined, name: 'ok', type: 'text', position: undefined, category_id: null }], roles: [] })
  })

  it('aperçu des rôles d’un modèle partagé', () => {
    const d = parseTemplateData({ roles: [{ name: 'Modo', color: 0xff0000, position: 2 }, { name: 'Membre', position: 1 }] })
    expect(templatePreview(d).roles.map((r) => r.name)).toEqual(['Membre', 'Modo'])
  })
})

describe('nom du serveur (bornes du serveur, en octets)', () => {
  it('compte les octets UTF-8', () => {
    expect(utf8Length('abc')).toBe(3)
    expect(utf8Length('é')).toBe(2)
    expect(utf8Length('🎮')).toBe(4)
  })
  it('2 à 100 octets', () => {
    expect(serverNameError('a')).not.toBeNull()
    expect(serverNameError('ab')).toBeNull()
    expect(serverNameError('é'.repeat(50))).toBeNull()
    expect(serverNameError('é'.repeat(51))).not.toBeNull()
  })
})
