// Message importé de Discord / webhook : enregistré sous l'id du propriétaire (ME) avec le nom et
// l'avatar Discord de l'auteur d'origine. Vérifie dans un vrai navigateur, sur dist/ :
//   - l'avatar passe par le proxy /api/og/image (blob:), jamais en direct vers cdn.discordapp.com ;
//   - un clic sur l'avatar ou le nom n'ouvre PAS le profil du propriétaire ;
//   - un message normal du propriétaire ouvre toujours son profil.
// Usage (depuis client/) : npx vite build && PW_MODULE=<…>/playwright/index.mjs node scripts/importedAuthor.playwright.mjs
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mockApi, ME, SERVER, CHANNEL } from './responsive.mocks.mjs'
const { chromium } = await import(process.env.PW_MODULE ?? 'playwright')
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 4179, BASE = `http://localhost:${PORT}`
const preview = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'pipe' })
for (let t = Date.now(); ; ) { try { if ((await fetch(BASE)).ok) break } catch {} if (Date.now() - t > 30_000) throw new Error('preview'); await new Promise(r => setTimeout(r, 300)) }
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const AVATAR = 'https://cdn.discordapp.com/avatars/155400000000000000/abc.png'
let fails = 0
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++ }
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block', locale: 'fr-FR' })
await mockApi(ctx)
const direct = []
await ctx.route(u => u.hostname === 'cdn.discordapp.com', r => { direct.push(r.request().url()); r.fulfill({ status: 200, contentType: 'image/png', body: PNG }) })
await ctx.route(u => u.pathname === '/api/og/image', r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
await ctx.route(u => new RegExp(`/api/servers/${SERVER}/channels/${CHANNEL}/messages$`).test(u.pathname), r => r.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify([
    { id: 'cccccccc-0000-4000-8000-000000000001', channel_id: CHANNEL, author_id: ME, author_username: 'AuteurDiscord', author_avatar: AVATAR, author_is_bot: false, content: 'message importé', created_at: new Date(Date.now() - 120_000).toISOString(), edited_at: null, reactions: [], attachments: [], pinned: false },
    { id: 'cccccccc-0000-4000-8000-000000000002', channel_id: CHANNEL, author_id: ME, author_username: 'moi', author_avatar: null, author_is_bot: false, content: 'message du propriétaire', created_at: new Date(Date.now() - 60_000).toISOString(), edited_at: null, reactions: [], attachments: [], pinned: false },
  ]),
}))
const page = await ctx.newPage()
await page.goto(`${BASE}/servers/${SERVER}/channels/${CHANNEL}`, { waitUntil: 'load' })
// L'écran de clé E2E recouvre l'appli faute de clé dans ce navigateur (même parade que responsive.playwright.mjs).
await page.addStyleTag({ content: 'div.fixed.inset-0:has(> [role="dialog"] input[type="password"]){display:none!important}' })
await page.getByText('message importé').waitFor({ timeout: 20_000 })
await page.waitForTimeout(1500)
const row = page.locator('[data-msg-row="cccccccc-0000-4000-8000-000000000001"]')
const src = await row.locator('.fc-avatar img').getAttribute('src').catch(() => null)
ok(!!src && src.startsWith('blob:'), `avatar via le proxy (src=${src?.slice(0, 30)})`)
ok(direct.length === 0, `aucune requête directe vers cdn.discordapp.com (${direct.length})`)
const dialogs = () => page.locator('[role="dialog"]').count()
const before = await dialogs()
await row.locator('.fc-avatar').click()
await row.locator('.fc-msg-name').click()
await page.waitForTimeout(500)
ok(await dialogs() === before, 'clic sur l’auteur importé : aucun profil ouvert')
const own = page.locator('[data-msg-row="cccccccc-0000-4000-8000-000000000002"]')
await own.locator('.fc-msg-name, .fc-avatar').first().click()
await page.waitForTimeout(800)
ok(await dialogs() > before || await page.getByText('moi', { exact: false }).count() > 1, 'clic sur le propriétaire : son profil s’ouvre')
await browser.close(); preview.kill()
console.log(fails ? `${fails} échec(s)` : 'Tout est passé.')
process.exit(fails ? 1 : 0)
