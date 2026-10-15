// Tutoriels (page /tutos + barre des serveurs), API factice (scripts/responsive.mocks.mjs + contrat /tutorials).
// Usage (depuis client/) :
//   PW_MODULE=D:/Projet/forgechat-loop/node_modules/playwright/index.mjs SHOTS=<dossier> node scripts/tutos.playwright.mjs
//   Edge installé via D:\Projet\outils\edge_playwright.mjs (jamais chromium.launch({channel}) en boucle).
import { pathToFileURL, fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { mockApi } from './responsive.mocks.mjs'

const { chromium } = await import(pathToFileURL(process.env.PW_MODULE).href)
const { edge } = await import('file:///D:/Projet/outils/edge_playwright.mjs')
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = process.env.SHOTS
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const HIDE_GATE = 'div.fixed.inset-0:has(> [role="dialog"] input[type="password"]){display:none!important}'
const PORT = 5197
const BASE = `http://localhost:${PORT}`

const CATS = [
  ['android', 'Android', ['Android 14', 'Android 13']], ['applications', 'Applications', []], ['applications-heiphaistos', 'Applications Heiphaistos', []],
  ['cmd-powershell', 'CMD / PowerShell', []], ['discord', 'Discord', []], ['linux', 'Linux', ['Ubuntu', 'Debian', 'Fedora', 'Arch']],
  ['logiciels', 'Logiciels', []], ['programmation', 'Programmation', []], ['reseau', 'Réseau', []], ['securite', 'Sécurité', []],
  ['windows', 'Windows', ['Windows 10', 'Windows 11']], ['macos', 'macOS', ['Sonoma', 'Ventura']],
]
const ITEMS = CATS.flatMap(([slug, name, groups]) => Array.from({ length: 30 }, (_, i) => ({
  slug: `${slug}-${i}`, title: `${name} : tutoriel numéro ${i + 1} sur une manipulation assez longue pour tester le retour à la ligne`,
  description: 'Pas à pas pour configurer, installer et dépanner, avec les commandes à copier.',
  category: { slug, name, icon: slug }, group: groups.length ? groups[i % groups.length] : null, tags: ['astuce', slug, 'pas-a-pas'],
  video_url: 'https://tuto.heiphaistos.org/videos/x.mp4', created_at: '2026-10-01T10:00:00Z',
})))
const HTML = '<h2>Étapes</h2><p>Ouvrir <strong>le terminal</strong> puis taper :</p><pre><code>sudo apt update &amp;&amp; sudo apt upgrade</code></pre><ul><li>un</li><li>deux</li></ul><p><a href="https://tuto.heiphaistos.org">site</a><script>window.__xss=1</script><img src=x onerror="window.__xss=1"></p>'

const spawnVite = () => {
  const p = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'pipe' })
  return p
}
const vite = spawnVite()
const until = Date.now() + 40_000
for (;;) {
  try { if ((await fetch(BASE)).ok) break } catch { /* pas encore prêt */ }
  if (Date.now() > until) { vite.kill(); throw new Error('vite ne répond pas') }
  await new Promise(r => setTimeout(r, 400))
}

const fails = []
const check = (ok, msg) => { console.log(`${ok ? 'ok ' : 'KO '} ${msg}`); if (!ok) fails.push(msg) }
let ctx
try {
  for (const [w, h, label] of [[1400, 900, 'desk'], [390, 800, 'mob']]) {
    ctx = await edge(chromium, { viewport: { width: w, height: h }, locale: 'fr-FR', serviceWorkers: 'block', isMobile: w < 500, hasTouch: w < 500 })
    await mockApi(ctx)
    const puts = []
    await ctx.route(u => u.pathname.startsWith('/api/tutorials') || u.pathname === '/api/users/me/server-layout', route => {
      const url = new URL(route.request().url())
      const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
      if (url.pathname.endsWith('/server-layout')) {
        if (route.request().method() === 'PUT') puts.push(route.request().postDataJSON())
        return json(route.request().method() === 'PUT' ? { ok: true } : null)
      }
      if (url.pathname === '/api/tutorials/catalog') {
        return json({ categories: CATS.map(([slug, name, groups]) => ({ slug, name, icon: slug, count: 30, groups: groups.map(g => ({ key: g, label: g, count: Math.round(30 / groups.length) })) })) })
      }
      if (url.pathname === '/api/tutorials') {
        const c = url.searchParams.get('category'); const g = url.searchParams.get('group'); const q = (url.searchParams.get('q') ?? '').toLowerCase()
        const page = Number(url.searchParams.get('page') ?? 1); const per = Number(url.searchParams.get('per_page') ?? 24)
        const all = ITEMS.filter(i => (!c || i.category.slug === c) && (!g || i.group === g) && (!q || i.title.toLowerCase().includes(q)))
        return json({ items: all.slice((page - 1) * per, page * per), total: all.length, page, per_page: per })
      }
      const it = ITEMS.find(i => url.pathname.endsWith('/' + i.slug))
      return it ? json({ ...it, content_html: HTML }) : route.fulfill({ status: 404, body: '{}' })
    })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    page.setDefaultTimeout(90_000)
    await ctx.addInitScript(() => localStorage.setItem('fc_onboarding_done', 'true'))
    page.on('load', () => page.addStyleTag({ content: HIDE_GATE }).catch(() => {}))
    const shot = n => SHOTS && page.screenshot({ path: join(SHOTS, `${label}-${n}.png`) })
    await page.goto(BASE + '/tutos', { waitUntil: 'load' })
    await page.waitForSelector('h3')
    await shot('liste')
    check((await page.locator('h3').count()) === 24, `${label} : 24 cartes puis Voir plus`)
    await page.locator('button:has-text("Voir plus")').click()
    await page.waitForFunction(() => document.querySelectorAll('h3').length === 48)
    check(true, `${label} : page suivante chargée`)

    // Catégorie puis version
    await page.locator(w < 500 ? 'div.md\\:hidden button:has-text("Linux")' : 'aside button:has-text("Linux")').first().click()
    await page.locator(w < 500 ? 'div.md\\:hidden button:has-text("Fedora")' : 'aside button:has-text("Fedora")').first().click()
    await page.waitForFunction(() => /group=Fedora/.test(location.search))
    await page.waitForTimeout(500)
    await shot('linux-fedora')
    check((await page.locator('h3').count()) > 0 && (await page.locator('h3').count()) < 30, `${label} : filtre Linux > Fedora`)

    // Détail
    await page.locator('a:has(h3)').first().click()
    await page.waitForSelector('video, :text("Vidéo indisponible")')
    const hasPlayer = await page.evaluate(() => { const v = document.querySelector('video'); return !v || (v.controls && v.src.startsWith('https://tuto.heiphaistos.org/')) })
    await page.waitForTimeout(400)
    await shot('detail')
    check(hasPlayer, `${label} : lecteur vidéo avec contrôles (ou repli si le fichier de test n'existe pas)`)
    check(await page.locator('.fc-tuto-body, pre code').count() > 0 && (await page.evaluate(() => window.__xss)) === undefined, `${label} : contenu rendu, script et onerror inertes`)
    check(await page.locator('article script, article img[src="x"]').count() === 0, `${label} : aucune balise script / image hostile`)

    // Barre des serveurs
    await page.goto(BASE + '/friends', { waitUntil: 'load' })
    await page.waitForSelector('.fc-server-rail')
    const rail = page.locator('.fc-server-rail')
    const names = async () => rail.locator('> div > button[aria-label]').evaluateAll(b => b.slice(0, 6).map(x => x.getAttribute('aria-label')))
    const n0 = await names()
    console.log(label, n0.join(' | '))
    check(n0.indexOf('Tutoriel') >= 0 && n0.indexOf('Tutoriel') + 1 === n0.indexOf('Actualités'), `${label} : Tutoriel juste au-dessus d'Actualités`)
    if (w >= 500) {
      const rb = await rail.boundingBox()
      await page.mouse.click(rb.x + 36, rb.y + rb.height - 6, { button: 'right' })
      await page.waitForSelector('[role="menu"]')
      await shot('menu-rail')
      await page.locator('[role="menuitemcheckbox"]:has-text("Actualités")').click()
      await page.keyboard.press('Escape')
      check(!(await names()).includes('Actualités'), 'Actualités masquée via le menu du vide')
      // Glisser Tutoriel au-dessus de Messages directs
      await page.locator('.fc-server-rail > div:has(button[aria-label="Tutoriel"])').dragTo(page.locator('.fc-server-rail > div:has(button[aria-label="Messages directs"])'), { targetPosition: { x: 36, y: 4 } })
      await page.waitForTimeout(1200)
      const n1 = await names()
      check(n1[0] === 'Tutoriel', 'glisser-déposer : Tutoriel en premier (' + n1.join(',') + ')')
      const last = puts.at(-1)
      check(last && last.hidden?.includes('news') && last.fixed?.[0] === 'tutorials', 'disposition enregistrée avec hidden + fixed : ' + JSON.stringify(last))
      await page.locator('button[aria-label="Messages directs"]').click({ button: 'right' })
      await page.locator('[role="menuitem"]:has-text("Masquer")').click()
      check(!(await names()).includes('Messages directs'), 'clic droit sur une entrée : Masquer')
      await page.mouse.click(rb.x + 36, rb.y + rb.height - 6, { button: 'right' })
      await page.locator('[role="menuitem"]:has-text("Réinitialiser")').click()
      const n2 = await names()
      check(n2.includes('Actualités') && n2.includes('Messages directs') && n2.indexOf('Tutoriel') + 1 === n2.indexOf('Actualités'), 'Réinitialiser : ordre et affichage d\'origine')
    }
    check(errors.length === 0, `${label} : aucune erreur JS ${errors.join(' / ')}`)
    await ctx.close()
  }
} finally {
  await ctx?.close().catch(() => {})
  vite.kill()
}
if (fails.length) { console.log(`${fails.length} échec(s)`); process.exit(1) }
