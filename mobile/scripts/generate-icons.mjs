#!/usr/bin/env node
// Icônes et écran de démarrage de l'app, générés depuis le logo officiel du web
// (client/public/icon.svg : bulle de chat, enclume, étincelles, dégradé #5865F2 → #7C3AED).
//
//   node scripts/generate-icons.mjs [--chrome /chemin/vers/chrome]
//
// Rendu par Chrome headless (aucune dépendance npm) : rendu SVG fidèle (dégradés, opacités).
// Produit, pour la variante « prod » (assets/) et « dev » (assets/dev/, fond orange + « DEV ») :
//   icon.png (1024, icône classique), android-icon-background.png / -foreground.png /
//   -monochrome.png (1024, icône adaptative ; avant-plan dans le cercle de sécurité 66/108),
//   splash-icon.png (1024), notification-icon.png (96, blanc sur transparent).
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '../assets')
const chromeArg = process.argv.indexOf('--chrome')
const CHROME = chromeArg > 0 ? process.argv[chromeArg + 1] : process.env.CHROME ?? '/usr/bin/google-chrome'

const VARIANTS = {
  prod: { dir: ASSETS, from: '#5865F2', to: '#7C3AED', glowFrom: '#818CF8', glowTo: '#5865F2', dev: false },
  dev: { dir: join(ASSETS, 'dev'), from: '#F59E0B', to: '#EA580C', glowFrom: '#FDE68A', glowTo: '#F59E0B', dev: true },
}

// ─── Dessin du logo (coordonnées du SVG web, carré de 512) ──────────────────
const BUBBLE =
  'M96 140 C96 114 116 96 142 96 L370 96 C396 96 416 114 416 140 L416 300 C416 326 396 344 370 344 L290 344 L256 400 L222 344 L142 344 C116 344 96 326 96 300 Z'

const defs = (v) => `<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${v.from}"/><stop offset="100%" stop-color="${v.to}"/></linearGradient>
  <linearGradient id="glow" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${v.glowFrom}"/><stop offset="100%" stop-color="${v.glowTo}"/></linearGradient>
</defs>`

/** Bulle, enclume et étincelles en couleurs (identique au web). */
const art = (v) => `
  <path d="${BUBBLE}" fill="white" fill-opacity="0.12"/>
  <path d="${BUBBLE}" stroke="white" stroke-opacity="0.25" stroke-width="3" fill="none"/>
  <rect x="176" y="230" width="160" height="72" rx="12" fill="url(#glow)"/>
  <path d="M176 248 L136 268 C126 272 126 286 136 290 L176 302 Z" fill="url(#glow)"/>
  <rect x="156" y="196" width="200" height="44" rx="8" fill="white"/>
  <rect x="208" y="302" width="96" height="18" rx="6" fill="url(#glow)" opacity="0.8"/>
  <circle cx="312" cy="168" r="6" fill="#FCD34D"/>
  <line x1="312" y1="155" x2="312" y2="148" stroke="#FCD34D" stroke-width="3" stroke-linecap="round"/>
  <line x1="322" y1="158" x2="327" y2="153" stroke="#FCD34D" stroke-width="3" stroke-linecap="round"/>
  <line x1="325" y1="168" x2="332" y2="168" stroke="#FCD34D" stroke-width="3" stroke-linecap="round"/>
  <circle cx="348" cy="188" r="4" fill="#FCD34D" opacity="0.7"/>
  <line x1="348" y1="178" x2="348" y2="173" stroke="#FCD34D" stroke-width="2.5" stroke-linecap="round" opacity="0.7"/>
  <line x1="355" y1="183" x2="359" y2="179" stroke="#FCD34D" stroke-width="2.5" stroke-linecap="round" opacity="0.7"/>
  ${v.dev ? devPill() : ''}`

/** Pastille « DEV » sous l'enclume, dans la bulle. */
const devPill = (fill = '#111827', text = '#FCD34D') => `
  <rect x="186" y="334" width="140" height="50" rx="25" fill="${fill}"/>
  <text x="256" y="372" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="800" font-size="38" fill="${text}">DEV</text>`

/** Silhouette d'une seule couleur (monochrome Android 13+, notification). */
const silhouette = (stroke, dev) => `
  <path d="${BUBBLE}" stroke="white" stroke-width="${stroke}" stroke-linejoin="round" fill="none"/>
  <rect x="176" y="230" width="160" height="72" rx="12" fill="white"/>
  <path d="M176 248 L136 268 C126 272 126 286 136 290 L176 302 Z" fill="white"/>
  <rect x="156" y="196" width="200" height="44" rx="8" fill="white"/>
  <rect x="208" y="302" width="96" height="18" rx="6" fill="white"/>
  ${dev
    ? '<text x="256" y="176" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="800" font-size="46" fill="white">DEV</text>'
    : '<circle cx="318" cy="166" r="12" fill="white"/>'}`

// Contenu centré : centre du dessin (256, 248) ; k = échelle dans un canevas de 1024.
const centered = (k, inner) => `<g transform="translate(512 512) scale(${k}) translate(-256 -248)">${inner}</g>`

const svg = (size, body, extraDefs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">${extraDefs}${body}</svg>`

const files = (v) => ({
  // Icône classique et écran de démarrage : le logo complet, coins arrondis comme le web.
  'icon.png': [1024, svg(1024, `<g transform="scale(2)"><rect width="512" height="512" rx="110" fill="url(#bg)"/>${art(v)}</g>`, defs(v))],
  // Écran de démarrage Android 12+ : l'image est découpée dans un cercle de 2/3 de son côté
  // (rayon ≈ 341 px) ; logo réduit pour que ses coins arrondis restent dedans (≈ 332 px).
  'splash-icon.png': [1024, svg(1024, `<g transform="translate(512 512) scale(1.05) translate(-256 -256)"><rect width="512" height="512" rx="110" fill="url(#bg)"/>${art(v)}</g>`, defs(v))],
  // Icône adaptative : fond plein (le système applique la forme) ; avant-plan dans le cercle
  // de sécurité (rayon 33/108 du canevas ≈ 313 px sur 1024) ; le point du dessin le plus éloigné
  // du centre (coin arrondi de la bulle) est à ≈ 201 unités → échelle 1,5 (≈ 302 px).
  'android-icon-background.png': [1024, svg(1024, '<rect width="1024" height="1024" fill="url(#bg)"/>', defs(v))],
  'android-icon-foreground.png': [1024, svg(1024, centered(1.5, art(v)), defs(v))],
  'android-icon-monochrome.png': [1024, svg(1024, centered(1.5, silhouette(14, v.dev)))],
  // Notification : blanc sur transparent (Android n'utilise que l'alpha), traits épais pour 24 dp.
  'notification-icon.png': [96, svg(96, centered(1.75, silhouette(30, false)))],
})

const tmp = mkdtempSync(join(tmpdir(), 'fc-icons-'))
try {
  for (const [name, v] of Object.entries(VARIANTS)) {
    mkdirSync(v.dir, { recursive: true })
    for (const [file, [size, markup]] of Object.entries(files(v))) {
      const html = join(tmp, `${name}-${file}.html`)
      writeFileSync(html, `<html><body style="margin:0;background:transparent">${markup}</body></html>`)
      execFileSync(CHROME, [
        '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-sandbox',
        `--window-size=${size},${size}`, '--default-background-color=00000000',
        `--screenshot=${join(v.dir, file)}`, `file://${html}`,
      ], { stdio: 'ignore' })
      console.log(`${name.padEnd(4)} ${file} (${size} px)`)
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
