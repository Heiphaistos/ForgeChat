import {
  parseRemoteTemplates,
  parseTemplateData,
  serverNameError,
  templatePreview,
  utf8Length,
} from '@/features/servers/templates'

describe('modèles intégrés (tenus par le serveur, GET /templates → builtin)', () => {
  const raw = {
    builtin: [
      { id: 'gaming', template_data: { categories: [{ id: 'c0', name: 'Infos', position: 0 }], channels: [{ name: 'annonces', type: 'announcement', category_id: 'c0' }], roles: [] } },
      { id: 'jotunheim', template_data: { categories: [{ id: 'c0', name: '・・・INFORMATION・・・', position: 0 }, { id: 'c4', name: '・・・ADMINISTRATEUR・・・', position: 4, staff_only: true }], channels: [], roles: [] } },
      { id: 'inconnu', template_data: {} },
    ],
  }

  it('noms traduits, modèle inconnu ignoré', () => {
    const r = parseRemoteTemplates(raw)
    expect(r.builtin.map((t) => [t.id, t.name, t.source])).toEqual([['gaming', 'Gaming', 'builtin'], ['jotunheim', 'Jötunheim', 'builtin']])
  })

  it('Jötunheim : des catégories, aucun salon', () => {
    const jot = parseRemoteTemplates(raw).builtin[1]!
    const p = templatePreview(jot.data)
    expect(p.channelCount).toBe(0)
    expect(p.sections.map((s) => s.title)).toEqual(['・・・INFORMATION・・・', '・・・ADMINISTRATEUR・・・'])
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
    expect(parseRemoteTemplates(null)).toEqual({ builtin: [], public: [], mine: [] })
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
