// Test responsive : aucune page ne doit défiler horizontalement sur téléphone.
// Visite les pages publiques (accueil, connexion, inscription, téléchargement, fonctionnalités)
// et les pages connectées (salon, tiroir, membres, profil, réglages serveur/salon, création de
// serveur, vocal et appel, MP, groupe, amis, réglages) avec une API factice
// (scripts/responsive.mocks.mjs), de 320 à 768 px, portrait et paysage.
// Échec (code 1) si, sur une page :
//   - documentElement.scrollWidth ou body.scrollWidth dépasse innerWidth ;
//   - un conteneur overflow-x:hidden a été décalé (scrollLeft > 0 : contenu trop large et coupé) ;
//   - une zone pleine largeur défile à l'horizontale (liste de messages trop large…) ;
//   - sous 768 px, un champ de saisie a une police < 16 px (zoom iOS au focus).
//
// Usage (depuis client/) :
//   npx vite build && PW_MODULE=<chemin>/node_modules/playwright/index.mjs node scripts/responsive.playwright.mjs
//   BASE_URL=http://localhost:5173 ...   : teste un serveur déjà lancé (dev) au lieu de `vite preview` sur dist/
//   SHOTS=<dossier>                     : enregistre une capture par page et par taille
//   VERBOSE=1                           : liste les éléments qui dépassent du viewport (aide au diagnostic)
//   ONLY=360x740 PAGES=salon,mp         : restreint tailles et pages
// Playwright n'est pas une dépendance du client : PW_MODULE pointe vers une installation à part
// (version dont le Chromium est installé, ex. playwright@1.63.0 ↔ chromium-1243).
import { pathToFileURL, fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { mockApi, ME, SERVER, CHANNEL, VOICE, DM, GROUP } from './responsive.mocks.mjs'

const { chromium } = await import(process.env.PW_MODULE ? pathToFileURL(process.env.PW_MODULE).href : 'playwright')
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 5199
const SHOTS = process.env.SHOTS
const VERBOSE = !!process.env.VERBOSE
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

// ONLY=360x740,844x390 : restreint les tailles ; PAGES=salon,mp : restreint les pages.
const only = (env, key) => list => env ? list.filter(x => env.split(',').includes(key(x))) : list
const SIZES = only(process.env.ONLY, ([w, h]) => `${w}x${h}`)([
  [320, 640], [360, 740], [390, 844], [414, 896], [768, 1024], // portrait
  [740, 360], [844, 390], // paysage
])

// ── Serveur ────────────────────────────────────────────────────────────────
let preview = null
let BASE = process.env.BASE_URL
if (!BASE) {
  BASE = `http://localhost:${PORT}`
  preview = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'pipe' })
  preview.stderr.on('data', d => process.stderr.write(d))
  const until = Date.now() + 20_000
  for (;;) {
    try { if ((await fetch(BASE)).ok) break } catch { /* pas encore prêt */ }
    if (Date.now() > until) { preview.kill(); throw new Error('vite preview ne répond pas (dist/ construit ?)') }
    await new Promise(r => setTimeout(r, 300))
  }
}

// ── Pages ──────────────────────────────────────────────────────────────────
/** Clics successifs ; `?sélecteur` : ignoré s'il n'est pas visible (ex. bouton du tiroir, absent dès 768 px). */
const click = (...sels) => async page => {
  for (const s of sels) {
    const loc = page.locator(s.replace(/^\?/, '')).first()
    if (s.startsWith('?') && !(await loc.isVisible())) continue
    await loc.click({ timeout: 5000 })
    await page.waitForTimeout(600)
  }
}
const DRAWER = '?button[aria-label="Ouvrir la liste des canaux"]'
const chan = `/servers/${SERVER}/channels/${CHANNEL}`
/** [nom, chemin, connecté ?, action après chargement (facultative)] */
const PAGES = only(process.env.PAGES, p => p[0])([
  ['accueil', '/', false],
  ['connexion', '/login', false],
  ['inscription', '/register', false],
  ['telecharger', '/telecharger', false],
  ['fonctionnalites', '/fonctionnalites', false],
  ['salon', chan, true],
  ['salon+tiroir', chan, true, click(DRAWER)],
  ['salon+membres', chan, true, click('button[aria-label="Liste des membres"]')],
  ['salon+profil', chan, true, click('[title="Profil de utilisateur_avec_un_pseudo_tres_long"]')],
  ['serveur+reglages', chan, true, click(DRAWER, 'button[aria-label="Ouvrir le menu serveur"]', 'text=Paramètres du serveur')],
  ['salon+reglages', chan, true, click(DRAWER, '[aria-label="Paramètres du canal general-avec-un-nom-de-salon-tres-long"]')],
  ['creer-serveur', chan, true, click(DRAWER, 'button[aria-label="Créer un serveur"]')],
  // Écran de déverrouillage des clés E2E (masqué sur les autres pages pour voir ce qu'il y a dessous).
  ['salon+cle-e2e', chan, true, null, { gate: true }],
  ['vocal', `/servers/${SERVER}/channels/${VOICE}`, true],
  // Vue « en appel » sans média : état du store vocal posé à la main (window.__fcVoiceStore, store/voice.ts).
  ['vocal+appel', `/servers/${SERVER}/channels/${VOICE}`, true, page => page.evaluate(([s, v, me]) => {
    window.__fcVoiceStore.setState({ joined: true, channelId: v, serverId: s, channelName: 'Vocal',
      roomParticipants: { [v]: [{ userId: me, username: 'momo', muted: false, video: false, screen: false }] } })
  }, [SERVER, VOICE, ME]).then(() => page.waitForTimeout(600))],
  ['mp', `/dms/${DM}`, true],
  ['groupe', `/dms/groups/${GROUP}`, true],
  ['amis', '/friends', true],
  ['reglages', '/settings', true],
  ['reglages+compte', '/settings', true, click('button:has-text("Mon compte")')],
  ['reglages+profil', '/settings', true, click('button:has-text("Profil utilisateur")')],
  ['reglages+apparence', '/settings', true, click('button:has-text("Apparence")')],
])
// L'écran E2E (e2e/E2EGate.tsx) recouvre toute l'appli connectée faute de clé dans ce navigateur.
const HIDE_GATE = 'div.fixed.inset-0:has(> [role="dialog"] input[type="password"]){display:none!important}'

const measure = verbose => {
  const de = document.documentElement
  const w = window.innerWidth
  const all = document.body.querySelectorAll('*')
  const label = el => `${el.tagName.toLowerCase()}.${typeof el.className === 'string' ? el.className.slice(0, 80) : ''}`
  // Conteneur `overflow-x: hidden` décalé (scrollLeft > 0) : contenu trop large que le navigateur a fait
  // défiler (focus, scrollIntoView) — invisible pour scrollWidth du document, mais la page paraît coupée.
  const shifted = []
  for (const el of all) {
    if (el.scrollLeft > 0 && /(hidden|clip)/.test(getComputedStyle(el).overflowX)) shifted.push(`${label(el)} scrollLeft=${el.scrollLeft}`)
    // Zone pleine largeur (liste de messages, page de réglages…) qui défile à l'horizontale : contenu trop large.
    else if (el.clientWidth >= w * 0.95 && el.scrollWidth > el.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowX)) {
      shifted.push(`${label(el)} scrollWidth=${el.scrollWidth}`)
    }
  }
  // iOS zoome au focus d'un champ dont la police fait moins de 16 px : interdit sous 768 px.
  const zoom = w >= 768 ? [] : [...document.querySelectorAll('input, textarea, select')]
    .filter(el => el.getClientRects().length && !/^(checkbox|radio|range|file|color|hidden|submit|button)$/.test(el.type))
    .filter(el => parseFloat(getComputedStyle(el).fontSize) < 16)
    .map(el => `${label(el)} ${getComputedStyle(el).fontSize}`)
  const out = { w, doc: de.scrollWidth, body: document.body.scrollWidth, shifted, zoom, offenders: [] }
  if (!verbose) return out
  // Éléments visibles qui dépassent à droite (coupés compris), hors tiroir fermé et hors conteneur qui défile.
  for (const el of all) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.right <= w + 1 || r.left >= w) continue
    let p = el.parentElement, hidden = false
    while (p && p !== document.body) {
      const cs = getComputedStyle(p)
      if (/(auto|scroll)/.test(cs.overflowX) && p.getBoundingClientRect().right <= w + 1) { hidden = true; break }
      if (cs.transform !== 'none' && p.getBoundingClientRect().right <= 0) { hidden = true; break }
      p = p.parentElement
    }
    if (hidden) continue
    out.offenders.push(`${label(el)} right=${Math.round(r.right)}`)
    if (out.offenders.length > 8) break
  }
  return out
}

const browser = await chromium.launch()
const rows = []
let ko = 0
try {
  for (const [width, height] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, serviceWorkers: 'block', locale: 'fr-FR' })
    const misses = new Set()
    const api = await mockApi(ctx, misses)
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    page.setDefaultTimeout(15_000)
    for (const [name, path, logged, action, opts = {}] of PAGES) {
      let note = ''
      if (VERBOSE) console.log(`→ ${width}x${height} ${name}`)
      api.logged = logged
      try {
        await page.goto(BASE + path, { waitUntil: 'load' })
        await page.waitForTimeout(1200)
        if (logged && !opts.gate) await page.addStyleTag({ content: HIDE_GATE })
        if (action) await action(page).catch(e => { note = 'action KO: ' + e.message.split('\n')[0].slice(0, 60) })
      } catch (e) { note = 'navigation KO: ' + e.message.split('\n')[0] }
      const m = await page.evaluate(measure, VERBOSE)
      const bad = m.doc > m.w || m.body > m.w || m.shifted.length > 0 || m.zoom.length > 0
      if (bad) ko++
      if (m.shifted.length) note = (note ? note + ' ; ' : '') + 'décalé : ' + m.shifted[0].slice(0, 70)
      if (m.zoom.length) note = (note ? note + ' ; ' : '') + 'police < 16px : ' + m.zoom[0].slice(0, 70)
      rows.push({ taille: `${width}x${height}`, page: name, innerWidth: m.w, docScroll: m.doc, bodyScroll: m.body, ok: bad ? 'KO' : 'ok', note })
      if (VERBOSE && m.offenders.length) console.log(`  ${width}x${height} ${name} :\n    ` + m.offenders.join('\n    '))
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `${width}x${height}-${name.replace(/\W+/g, '_')}.png`) })
    }
    if (VERBOSE && errors.length) console.log(`  erreurs JS ${width}x${height} :`, [...new Set(errors)].slice(0, 5))
    if (VERBOSE && misses.size) console.log(`  routes non simulées :`, [...misses].slice(0, 40).join(', '))
    await ctx.close()
  }
} finally {
  await browser.close()
  preview?.kill()
}

console.table(rows)
console.log(ko ? `ÉCHEC : ${ko} page(s) en échec (défilement horizontal, conteneur décalé ou champ < 16 px)` : `OK : ${rows.length} vérifications : ni défilement horizontal, ni conteneur décalé, ni champ < 16 px`)
process.exit(ko ? 1 : 0)
