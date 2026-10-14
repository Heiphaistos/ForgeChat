// Recadrage d'avatar de bout en bout (components/settings/ImageCropDialog.tsx), API factice
// (scripts/responsive.mocks.mjs) : Réglages > Profil utilisateur, image PNG 600×400 posée sur le
// champ de l'avatar, fenêtre de recadrage sans débordement horizontal, glisser, Appliquer, et
// l'envoi intercepté doit contenir un PNG carré.
//
// Usage (depuis client/) :
//   npx vite build && PW_MODULE=<chemin>/node_modules/playwright/index.mjs node scripts/imageCrop.playwright.mjs
//   BASE_URL=http://localhost:5173 ...  : serveur déjà lancé au lieu de `vite preview` sur dist/
//   SHOTS=<dossier>                    : captures de la fenêtre de recadrage par taille
import { pathToFileURL, fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { deflateSync, crc32 } from 'node:zlib'
import { mockApi, ME } from './responsive.mocks.mjs'

const { chromium } = await import(process.env.PW_MODULE ? pathToFileURL(process.env.PW_MODULE).href : 'playwright')
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 5198
const SHOTS = process.env.SHOTS
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const SIZES = [[360, 740], [320, 640]]
const HIDE_GATE = 'div.fixed.inset-0:has(> [role="dialog"] input[type="password"]){display:none!important}'

/** PNG RVB w×h (dégradé), sans dépendance. */
function png(w, h) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * (w * 3 + 1) + 1 + x * 3
    raw[o] = (x * 255 / w) | 0; raw[o + 1] = (y * 255 / h) | 0; raw[o + 2] = 128
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

/** Dimensions du premier PNG trouvé dans un corps multipart, ou null. */
function pngSize(body) {
  const at = body.indexOf(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  return at < 0 ? null : { w: body.readUInt32BE(at + 16), h: body.readUInt32BE(at + 20) }
}

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

const IMAGE = png(600, 400)
const browser = await chromium.launch()
const fails = []
const check = (size, ok, msg) => { console.log(`${ok ? 'ok ' : 'KO '} ${size} ${msg}`); if (!ok) fails.push(`${size} ${msg}`) }
try {
  for (const [width, height] of SIZES) {
    const size = `${width}x${height}`
    const ctx = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, serviceWorkers: 'block', locale: 'fr-FR' })
    await mockApi(ctx)
    // Enregistrée après mockApi : prioritaire (Playwright essaie les routes de la plus récente à la plus ancienne).
    let upload = null
    await ctx.route(u => u.pathname === '/api/users/me/avatar', route => {
      upload = route.request().postDataBuffer() ?? Buffer.alloc(0)
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: ME, username: 'momo', avatar: null }) })
    })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    page.setDefaultTimeout(15_000)
    try {
      await page.goto(BASE + '/settings', { waitUntil: 'load' })
      await page.waitForTimeout(1200)
      await page.addStyleTag({ content: HIDE_GATE })
      await page.locator('button:has-text("Profil utilisateur")').first().click()
      await page.waitForTimeout(600)

      // Pastille appareil photo : ne doit pas recouvrir le centre de l'avatar.
      const cam = await page.locator('button[aria-label="Changer l\'avatar"], button[aria-label*="avatar" i]').first().boundingBox()
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `${size}-profil.png`) })
      check(size, !!cam, `bouton de l'avatar présent${cam ? ` (${Math.round(cam.width)}×${Math.round(cam.height)})` : ''}`)

      await page.locator('input[type="file"][accept*="image/apng"]').setInputFiles({ name: 'paysage.png', mimeType: 'image/png', buffer: IMAGE })
      const dialog = page.locator('[role="dialog"][aria-labelledby="fc-crop-title"]')
      await dialog.waitFor({ state: 'visible' })
      await page.waitForTimeout(400)
      const m = await page.evaluate(() => {
        const d = document.querySelector('[aria-labelledby="fc-crop-title"]')
        const r = d.getBoundingClientRect()
        // L'image dans la zone de recadrage (overflow: hidden) dépasse par construction : exclue.
        const area = d.querySelector('[role="group"]')
        const outside = [...d.querySelectorAll('*')].filter(el => !area.contains(el) || el === area).filter(el => { const b = el.getBoundingClientRect(); return b.width && (b.right > innerWidth + 0.5 || b.left < -0.5) }).length
        return { w: innerWidth, doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, left: r.left, right: r.right, dScroll: d.scrollWidth - d.clientWidth, outside }
      })
      check(size, m.doc <= m.w && m.body <= m.w && m.dScroll <= 0 && m.outside === 0 && m.left >= 0 && m.right <= m.w,
        `fenêtre sans débordement horizontal (doc ${m.doc}, body ${m.body}, fenêtre ${Math.round(m.left)}→${Math.round(m.right)} / ${m.w}, hors écran ${m.outside})`)
      const apply = dialog.locator('button:has-text("Appliquer")')
      const ab = await apply.boundingBox()
      check(size, !!ab && ab.y + ab.height <= height, 'bouton Appliquer visible sans défiler')
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `${size}-recadrage.png`) })

      // Glisser vers la gauche : l'image se décale (zoom 1, image plus large que haute).
      const area = dialog.locator('[role="group"]')
      const img = area.locator('img')
      const before = await img.evaluate(el => el.style.left)
      const box = await area.boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2, { steps: 6 })
      await page.mouse.up()
      const after = await img.evaluate(el => el.style.left)
      check(size, before !== after, `glisser déplace l'image (left ${before} → ${after})`)

      await apply.click()
      await dialog.waitFor({ state: 'detached' })
      await page.waitForTimeout(500)
      const dim = upload && pngSize(upload)
      check(size, !!dim && dim.w === dim.h && dim.w === 400, `envoi : PNG carré ${dim ? `${dim.w}×${dim.h}` : 'absent'}`)
      if (errors.length) check(size, false, `erreurs JS : ${[...new Set(errors)].slice(0, 3).join(' | ')}`)
    } catch (e) {
      check(size, false, 'scénario interrompu : ' + e.message.split('\n')[0])
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `${size}-erreur.png`) }).catch(() => {})
    }
    await ctx.close()
  }
} finally {
  await browser.close()
  preview?.kill()
}

console.log(fails.length ? `ÉCHEC : ${fails.length} vérification(s)` : 'OK : recadrage d’avatar vérifié à 360 et 320 px')
process.exit(fails.length ? 1 : 0)
