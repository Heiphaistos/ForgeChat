// IA sur l'appareil (mobile) : résumé extractif identique au web et pont vers le moteur
// (WebView cachée simulée : aucun modèle n'est téléchargé ici).
import { summarize } from '@/lib/ai/summary'
import { aiCall, attach, onEngineMessage, useAiHost } from '@/features/ai/bridge'

describe('résumé extractif des non-lus (même cas que client/scripts/ai.test.mjs)', () => {
  it('mentions, réactions et contenu avant le bavardage, ordre chronologique', () => {
    const msgs = [
      { id: '1', author: 'Léa', text: 'ok' },
      { id: '2', author: 'Tom', text: 'Rendez-vous samedi à 14 h devant la gare pour la randonnée au lac, prenez de l’eau.', reactions: 4 },
      { id: '3', author: 'Léa', text: 'mdr' },
      { id: '4', author: 'Max', text: 'Qui peut apporter le pique-nique pour la randonnée samedi ?' },
      { id: '5', author: 'Tom', text: '<@me> tu peux confirmer pour la voiture ?', mentionsMe: true },
      { id: '6', author: 'Léa', text: 'trop bien' },
      { id: '7', author: 'Max', text: 'Voici le parcours : https://example.com/carte' },
    ]
    const s = summarize(msgs, 3)
    expect(s.count).toBe(7)
    expect(s.highlights.map((h) => h.id)).toEqual(['2', '4', '5'])
    expect(s.authors[0]?.name).toBe('Léa')
    expect(s.keywords).toContain('randonnee')
    expect(summarize([], 5).highlights).toEqual([])
  })
})

const sentRequest = (js: string | undefined) =>
  JSON.parse(js?.match(/fcAi\((.*)\);true;$/)?.[1] ?? '{}') as { id: number; op: string }

describe('pont vers le moteur local', () => {
  afterEach(() => attach(null))

  it('attend la page, transmet la requête, relaie la progression puis la réponse', async () => {
    const sent: string[] = []
    attach((js) => sent.push(js))
    onEngineMessage(JSON.stringify({ ready: true }))
    const progress: number[] = []
    const p = aiCall({ op: 'download', packs: ['runtime'] }, (x) => progress.push(x))
    expect(useAiHost.getState().active).toBe(true)
    await new Promise((r) => setTimeout(r, 0))
    expect(sent).toHaveLength(1)
    const req = sentRequest(sent[0])
    expect(req.op).toBe('download')
    onEngineMessage(JSON.stringify({ id: req.id, progress: 0.5 }))
    onEngineMessage('pas du JSON')
    onEngineMessage(JSON.stringify({ id: req.id, ok: true }))
    await expect(p).resolves.toEqual({ id: req.id, ok: true })
    expect(progress).toEqual([0.5])
  })

  it('moteur arrêté (mémoire, page absente) : réponse « engine », jamais d’exception', async () => {
    attach(() => undefined)
    onEngineMessage(JSON.stringify({ ready: true }))
    const p = aiCall({ op: 'status' })
    await new Promise((r) => setTimeout(r, 0))
    attach(null)
    await expect(p).resolves.toEqual({ ok: false, error: 'engine' })
  })
})
