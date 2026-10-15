import { parseTutorialHtml, safeHttp } from '@/features/tutorials/html'
import { nextPage } from '@/features/tutorials/api'
import { flatText } from '@/features/tutorials/TutorialBody'

const tags = (n: ReturnType<typeof parseTutorialHtml>): string[] => n.flatMap((x) => (x.t === 'el' ? [x.tag, ...tags(x.kids)] : []))

test('balises de la liste blanche gardées, imbrication correcte', () => {
  const out = parseTutorialHtml('<h2>Titre</h2><p>a <strong>b <em>c</em></strong></p><ul><li>un</li><li>deux</li></ul><hr><p>x<br>y</p>')
  expect(tags(out)).toEqual(['h2', 'p', 'strong', 'em', 'ul', 'li', 'li', 'hr', 'p', 'br'])
})

test('script, style, iframe, commentaires et balises inconnues jetés (texte des inconnues gardé)', () => {
  const out = parseTutorialHtml('<script>alert(1)</script><!-- x --><iframe src="https://e.com"></iframe><style>p{}</style><div onclick="x()"><p>ok</p></div><video src="a">v</video>')
  expect(tags(out)).toEqual(['p'])
  expect(flatText(out)).toBe('okv')
})

test('liens : http(s) seulement, aucun autre attribut conservé', () => {
  const out = parseTutorialHtml('<a href="https://a.fr/x" onclick="x()" style="color:red">ok</a><a href="javascript:alert(1)">js</a><a href=\'data:text/html,x\'>d</a><a href="https://u:p@e.com">cred</a>')
  const a = out.filter((n) => n.t === 'el') as Extract<(typeof out)[number], { t: 'el' }>[]
  expect(a.map((x) => x.href)).toEqual(['https://a.fr/x', undefined, undefined, undefined])
  expect(Object.keys(a[0] as object).sort()).toEqual(['href', 'kids', 't', 'tag'])
})

test('images : https seulement', () => {
  const out = parseTutorialHtml('<img src="https://t.org/a.png" alt="A" onerror="x()"><img src="http://t.org/b.png"><img src="javascript:x"><img src="/rel.png">')
  expect(out).toEqual([{ t: 'el', tag: 'img', kids: [], src: 'https://t.org/a.png', alt: 'A' }])
})

test('entités décodées, espaces repliés hors <pre>', () => {
  const out = parseTutorialHtml('<p>a &amp; b &lt;c&gt; &#233;\n   &#x41;</p><pre>l1\n  l2</pre>')
  expect(flatText(out)).toBe('a & b <c> é Al1\n  l2')
})

test('balises non fermées et fermetures orphelines : pas de plantage', () => {
  expect(tags(parseTutorialHtml('<p>un <strong>deux</p></em></li><ul><li>x'))).toEqual(['p', 'strong', 'ul', 'li'])
})

test('safeHttp', () => {
  expect(safeHttp('https://tuto.heiphaistos.org/videos/a.mp4', true)).toBe('https://tuto.heiphaistos.org/videos/a.mp4')
  expect(safeHttp('http://x.fr', true)).toBeUndefined()
  expect(safeHttp('http://x.fr')).toBe('http://x.fr/')
  expect(safeHttp('file:///etc/passwd')).toBeUndefined()
  expect(safeHttp(undefined)).toBeUndefined()
})

test('pagination', () => {
  expect(nextPage({ page: 1, per_page: 24, total: 50 })).toBe(2)
  expect(nextPage({ page: 3, per_page: 24, total: 50 })).toBeUndefined()
})
