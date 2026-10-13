/**
 * Personnalisation du profil, troisième série : décorations d'avatar (mythes, mignon, techno,
 * éléments) et effets de profil (animaux, gourmandises, symboles, lumières). Ajoutés à la fin du
 * catalogue, mêmes identifiants et même ordre que la liste blanche du serveur
 * (server/src/models/user.rs) et que le mobile (mobile/src/features/account/profileDecorExtra.ts).
 * Uniquement les primitives de rendu existantes ; couleurs et glyphes constants.
 */
import type { Deco, ProfileFx } from './profileDecor'
import type { Key } from '../i18n'

export const DECO_GROUPS_EXTRA: { id: string; label: Key; ids: string[] }[] = [
  { id: 'mythic', label: 'pdeco.group.mythic', ids: ['dragon_fire', 'frost_dragon', 'valkyrie', 'pharaoh', 'medusa', 'kitsune', 'oni', 'seraph', 'vampire', 'unicorn', 'cerberus'] },
  { id: 'cute', label: 'pdeco.group.cute', ids: ['kawaii_cat', 'bubblegum', 'cotton_candy', 'lollipop', 'bunny_love', 'teddy', 'strawberry', 'honey', 'mochi', 'starlight_bow', 'rainbow_cloud'] },
  { id: 'tech', label: 'pdeco.group.tech', ids: ['circuit', 'hud', 'reactor', 'hologrid', 'data_stream', 'warp_core', 'ufo', 'android', 'laser_grid', 'quantum', 'nanotech'] },
  { id: 'elements2', label: 'pdeco.group.elements2', ids: ['sandstorm_ring', 'volcano', 'crystal_cave', 'coral_reef', 'aurora_borealis', 'thunderstorm', 'flower_crown', 'eclipse', 'tsunami', 'wildfire', 'frozen_star'] },
]

export const DECORATIONS_EXTRA: Deco[] = [
  // Mythes et légendes
  { id: 'dragon_fire', label: 'pdeco.dragon_fire', colors: ['#8b0000', '#ff4500', '#ffd700'], kind: 'ring', anim: 'flicker', glow: '#ff4500', flames: true, ornament: 'horns' },
  { id: 'frost_dragon', label: 'pdeco.frost_dragon', colors: ['#0d47a1', '#81d4fa', '#e1f5fe'], kind: 'ring', anim: 'breathe', aura: '#81d4fa', rain: { chars: '❄❅❄❅', motion: 'fall' }, ornament: 'horns' },
  { id: 'valkyrie', label: 'pdeco.valkyrie', colors: ['#eceff1', '#ffd54f', '#90a4ae'], kind: 'dual', glow: '#ffd54f', wreath: 'ᛉᛏᛉᛏᛉᛏ', ornament: 'wings' },
  { id: 'pharaoh', label: 'pdeco.pharaoh', colors: ['#1a237e', '#ffd700', '#1a237e', '#ffd700'], kind: 'stripes', glow: '#ffd700', wreath: '☥△☥△☥△' },
  { id: 'medusa', label: 'pdeco.medusa', colors: ['#1b5e20', '#76ff03', '#33691e'], kind: 'ring', anim: 'spinrev', aura: '#76ff03', orbit: '∿', orbitN: 5 },
  { id: 'kitsune', label: 'pdeco.kitsune', colors: ['#ff7043', '#fff3e0', '#ff7043'], kind: 'ring', glow: '#ff7043', orbit: '●', orbitN: 3, ornament: 'foxears' },
  { id: 'oni', label: 'pdeco.oni', colors: ['#4a0000', '#d50000', '#212121'], kind: 'stripes', anim: 'flicker', glow: '#d50000', aura: '#d50000', ornament: 'horns' },
  { id: 'seraph', label: 'pdeco.seraph', colors: ['#ffffff', '#fffde7', '#ffe082'], kind: 'double', glow: '#ffe082', aura: '#fffde7', rain: { chars: '✦✧✦✧', motion: 'rise' }, ornament: 'halo' },
  { id: 'vampire', label: 'pdeco.vampire', colors: ['#1a0000', '#8b0000', '#1a0000'], kind: 'dual', anim: 'breathe', glow: '#b71c1c', rain: { chars: '•••••', motion: 'fall' }, ornament: 'batwings' },
  { id: 'unicorn', label: 'pdeco.unicorn', colors: ['#ffb3e6', '#b3e5ff', '#d9b3ff', '#fff5b3'], kind: 'ring', anim: 'hue', glow: '#ffb3e6', wreath: '✧✦✧✦✧✦' },
  { id: 'cerberus', label: 'pdeco.cerberus', colors: ['#3e2723', '#ff6d00', '#3e2723'], kind: 'ring', glow: '#ff6d00', flames: true, orbit: '●', orbitN: 3 },
  // Mignon
  { id: 'kawaii_cat', label: 'pdeco.kawaii_cat', colors: ['#ffd1dc', '#ffffff', '#ffd1dc'], kind: 'ring', wreath: '♡♡♡♡♡♡', ornament: 'catears' },
  { id: 'bubblegum', label: 'pdeco.bubblegum', colors: ['#ff8fcf', '#ffc2e2', '#ff5fae'], kind: 'stripes', anim: 'spin', rain: { chars: '○∘○∘○', motion: 'rise' } },
  { id: 'cotton_candy', label: 'pdeco.cotton_candy', colors: ['#ffc8dd', '#bde0fe', '#ffafcc', '#a2d2ff'], kind: 'ring', anim: 'breathe', aura: '#ffc8dd' },
  { id: 'lollipop', label: 'pdeco.lollipop', colors: ['#ff006e', '#ffffff', '#3a86ff', '#ffffff'], kind: 'stripes', anim: 'spinrev' },
  { id: 'bunny_love', label: 'pdeco.bunny_love', colors: ['#ffffff', '#ffb3c1'], kind: 'dual', orbit: '♥', orbitN: 2, ornament: 'bunnyears' },
  { id: 'teddy', label: 'pdeco.teddy', colors: ['#8d6e63', '#d7ccc8', '#8d6e63'], kind: 'ring', ornament: 'bow', thick: 1.2 },
  { id: 'strawberry', label: 'pdeco.strawberry', colors: ['#e63946', '#ff8fa3', '#2d6a4f'], kind: 'ring', glow: '#e63946', glyph: '❦' },
  { id: 'honey', label: 'pdeco.honey', colors: ['#ffb703', '#fb8500', '#ffd166'], kind: 'segments', glow: '#ffb703', wreath: '⬡⬡⬡⬡⬡⬡' },
  { id: 'mochi', label: 'pdeco.mochi', colors: ['#fdf0f5', '#e9f5db', '#fde2e4'], kind: 'double', glow: '#fde2e4', thick: 1.3 },
  { id: 'starlight_bow', label: 'pdeco.starlight_bow', colors: ['#cdb4db', '#ffc8dd', '#bde0fe'], kind: 'ring', rain: { chars: '✦✧✦✧', motion: 'twinkle' }, ornament: 'bow' },
  { id: 'rainbow_cloud', label: 'pdeco.rainbow_cloud', colors: ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#007aff', '#af52de'], kind: 'dual', anim: 'hue', rain: { chars: '☁☁☁☁', motion: 'rise' } },
  // Techno et science-fiction
  { id: 'circuit', label: 'pdeco.circuit', colors: ['#00e676', '#003d1f', '#00e676'], kind: 'segments', anim: 'steps', glow: '#00e676', wreath: '┼┼┼┼┼┼' },
  { id: 'hud', label: 'pdeco.hud', colors: ['#00e5ff', 'transparent', '#00e5ff', 'transparent'], kind: 'ring', anim: 'spin', glow: '#00e5ff', ripple: '#00e5ff' },
  { id: 'reactor', label: 'pdeco.reactor', colors: ['#00b0ff', '#e1f5fe', '#00b0ff'], kind: 'double', anim: 'pulse', aura: '#00b0ff', orbit: '•', orbitN: 6 },
  { id: 'hologrid', label: 'pdeco.hologrid', colors: ['#18ffff', '#0d47a1'], kind: 'frame', anim: 'hue', glow: '#18ffff' },
  { id: 'data_stream', label: 'pdeco.data_stream', colors: ['#00ff41', '#003b00'], kind: 'ring', anim: 'spin', glow: '#00ff41', rain: { chars: '01010', motion: 'fall' } },
  { id: 'warp_core', label: 'pdeco.warp_core', colors: ['#7c4dff', '#18ffff', '#7c4dff', '#18ffff'], kind: 'ring', anim: 'spin', aura: '#7c4dff', ripple: '#18ffff' },
  { id: 'ufo', label: 'pdeco.ufo', colors: ['#76ff03', '#9e9e9e', '#76ff03'], kind: 'double', ripple: '#76ff03', rain: { chars: '·•·•·', motion: 'rise' } },
  { id: 'android', label: 'pdeco.android', colors: ['#b0bec5', '#00e5ff', '#b0bec5'], kind: 'segments', glow: '#00e5ff', ornament: 'headphones' },
  { id: 'laser_grid', label: 'pdeco.laser_grid', colors: ['#ff1744', 'transparent', '#ff1744', 'transparent', '#ff1744', 'transparent'], kind: 'ring', anim: 'spinrev', glow: '#ff1744' },
  { id: 'quantum', label: 'pdeco.quantum', colors: ['#e040fb', '#00e5ff', '#e040fb'], kind: 'ring', anim: 'flash', glow: '#e040fb', orbit: '◆', orbitN: 4, arcs: '#00e5ff' },
  { id: 'nanotech', label: 'pdeco.nanotech', colors: ['#cfd8dc', '#37474f', '#cfd8dc', '#37474f'], kind: 'segments', anim: 'steps', glow: '#cfd8dc', thick: 0.8 },
  // Éléments, suite
  { id: 'sandstorm_ring', label: 'pdeco.sandstorm_ring', colors: ['#e0c38c', '#c2a36b', '#f5deb3'], kind: 'stripes', anim: 'spin', rain: { chars: '·•∙·•', motion: 'twinkle' } },
  { id: 'volcano', label: 'pdeco.volcano', colors: ['#3e2723', '#ff3d00', '#ffab00'], kind: 'ring', anim: 'flicker', aura: '#ff3d00', flames: true },
  { id: 'crystal_cave', label: 'pdeco.crystal_cave', colors: ['#b388ff', '#80deea', '#e1bee7'], kind: 'segments', anim: 'hue', glow: '#80deea', glyph: '◆' },
  { id: 'coral_reef', label: 'pdeco.coral_reef', colors: ['#ff7f50', '#40e0d0', '#ff7f50'], kind: 'ring', ripple: '#40e0d0', rain: { chars: '∘○∘○∘', motion: 'rise' } },
  { id: 'aurora_borealis', label: 'pdeco.aurora_borealis', colors: ['#00ffa3', '#7c4dff', '#00b4ff'], kind: 'dual', anim: 'hue', aura: '#00ffa3', rain: { chars: '·✧·✧·', motion: 'twinkle' } },
  { id: 'thunderstorm', label: 'pdeco.thunderstorm', colors: ['#263238', '#90a4ae', '#263238'], kind: 'ring', anim: 'flash', arcs: '#e3f2fd', rain: { chars: '╿╿╿╿╿', motion: 'fall' } },
  { id: 'flower_crown', label: 'pdeco.flower_crown', colors: ['#ff8fab', '#fff176', '#81c784'], kind: 'ring', wreath: '⚘✿⚘✿⚘✿' },
  { id: 'eclipse', label: 'pdeco.eclipse', colors: ['#000000', '#000000', '#ffd54f', '#000000'], kind: 'ring', anim: 'spin', glow: '#ffb300', aura: '#ffd54f' },
  { id: 'tsunami', label: 'pdeco.tsunami', colors: ['#01579b', '#4fc3f7', '#e1f5fe', '#01579b'], kind: 'stripes', anim: 'spinrev', ripple: '#4fc3f7', thick: 1.2 },
  { id: 'wildfire', label: 'pdeco.wildfire', colors: ['#ff6f00', '#ffca28', '#bf360c'], kind: 'segments', anim: 'flicker', glow: '#ff6f00', flames: true },
  { id: 'frozen_star', label: 'pdeco.frozen_star', colors: ['#e1f5fe', '#ffffff', '#81d4fa'], kind: 'double', glow: '#e1f5fe', orbit: '❄', orbitN: 6 },
]

export const PROFILE_EFFECTS_EXTRA: ProfileFx[] = [
  // Animaux
  { id: 'birds', label: 'pfx.birds', chars: ['⋎', 'v'], colors: ['#37474f', '#546e7a'], motion: 'flap', count: 10, size: 14 },
  { id: 'doves', label: 'pfx.doves', chars: ['⋎', '˅'], colors: ['#ffffff', '#eceff1'], motion: 'flap', overlay: 'sunrays', count: 8, size: 16 },
  { id: 'fish_school', label: 'pfx.fish_school', chars: ['><>', '<><'], colors: ['#4fc3f7', '#81d4fa', '#ffb74d'], motion: 'swirl', overlay: 'caustics', count: 14, size: 12 },
  { id: 'jellyfish', label: 'pfx.jellyfish', chars: ['◓'], colors: ['#ff9ff3', '#a0e7ff', '#d0a8ff'], motion: 'float', overlay: 'ocean', count: 8, size: 22 },
  { id: 'ladybugs', label: 'pfx.ladybugs', chars: ['●'], colors: ['#e53935', '#c62828'], motion: 'drift', count: 16, size: 9 },
  { id: 'bees', label: 'pfx.bees', chars: ['●'], colors: ['#ffd600', '#212121'], motion: 'flap', count: 14, size: 8 },
  // Gourmandises
  { id: 'donuts', label: 'pfx.donuts', chars: ['◎'], colors: ['#ff8fab', '#8d6e63', '#fff176'], motion: 'fall', count: 14, size: 16 },
  { id: 'popcorn', label: 'pfx.popcorn', chars: ['✿', '❁', '●'], colors: ['#fff8e1', '#ffe082'], motion: 'burst', count: 26, size: 10 },
  { id: 'sprinkles', label: 'pfx.sprinkles', chars: ['▬', '▮'], colors: ['#ff8fab', '#5ee7df', '#fff176', '#b388ff', '#ffffff'], motion: 'confetti', count: 32, size: 6 },
  { id: 'cookies', label: 'pfx.cookies', chars: ['◉', '●'], colors: ['#a1887f', '#6d4c41'], motion: 'fall', count: 12, size: 16 },
  { id: 'boba', label: 'pfx.boba', chars: ['●'], colors: ['#3e2723', '#5d4037'], motion: 'rise', count: 20, size: 10 },
  { id: 'sugar_rush', label: 'pfx.sugar_rush', chars: ['✦', '●', '◆'], colors: ['#ff4081', '#00e5ff', '#ffd600', '#76ff03'], motion: 'swirl', count: 30, size: 9 },
  { id: 'coffee', label: 'pfx.coffee', chars: ['∿', '~'], colors: ['#d7ccc8', '#efebe9'], motion: 'smoke', count: 12, size: 16 },
  // Symboles
  { id: 'zodiac', label: 'pfx.zodiac', chars: ['♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓'], colors: ['#ffd166', '#c3b1ff', '#8ec5ff'], motion: 'twinkle', overlay: 'nebula', count: 16, size: 14 },
  { id: 'peace', label: 'pfx.peace', chars: ['☮', '☯'], colors: ['#ffffff', '#b2ffda', '#ffd6e0'], motion: 'float', count: 10, size: 18 },
  { id: 'astral', label: 'pfx.astral', chars: ['☉', '☽', '☿', '♀', '♂', '♃', '♄'], colors: ['#fff1b8', '#c3b1ff'], motion: 'swirl', overlay: 'galaxy', count: 18, size: 13 },
  { id: 'music_wave', label: 'pfx.music_wave', chars: ['♩', '♪', '♫', '♬'], colors: ['#ff4081', '#ffd600', '#00e5ff'], motion: 'sway', overlay: 'equalizer', count: 18, size: 14 },
  { id: 'ankhs', label: 'pfx.ankhs', chars: ['☥'], colors: ['#ffd700', '#ffb300'], motion: 'twinkle', overlay: 'sand', count: 12, size: 16 },
  { id: 'mystery', label: 'pfx.mystery', chars: ['?', '¿', '!', '¡'], colors: ['#ffd600', '#ff4081', '#00e5ff'], motion: 'confetti', count: 18, size: 16 },
  { id: 'arrows', label: 'pfx.arrows', chars: ['➤', '➜', '➔'], colors: ['#00e676', '#00e5ff'], motion: 'diagonal', count: 14, size: 14 },
  { id: 'royalty', label: 'pfx.royalty', chars: ['♛', '♚'], colors: ['#ffd700', '#fff1b8'], motion: 'fall', overlay: 'spotlight', count: 12, size: 16 },
  // Lumières
  { id: 'bokeh', label: 'pfx.bokeh', chars: ['●'], colors: ['#ffd166', '#ff8fab', '#8ec5ff', '#b388ff'], motion: 'float', count: 14, size: 26 },
  { id: 'prism_light', label: 'pfx.prism_light', chars: ['◆', '◇'], colors: ['#ff9ff3', '#a0e7ff', '#c4ffb5', '#fff3a0', '#d0a8ff'], motion: 'twinkle', overlay: 'rainbow', count: 14, size: 10 },
  { id: 'candlelight', label: 'pfx.candlelight', chars: ['▲'], colors: ['#ffb300', '#ffe082', '#ff6f00'], motion: 'twinkle', overlay: 'dusk', count: 10, size: 12 },
  { id: 'neon_glow', label: 'pfx.neon_glow', chars: ['✦', '★', '♥'], colors: ['#ff2bd6', '#00f0ff', '#b6ff00'], motion: 'twinkle', overlay: 'scanlines', count: 14, size: 16 },
  { id: 'laser_show', label: 'pfx.laser_show', chars: ['│', '─', '╱', '╲'], colors: ['#ff1744', '#00e676', '#2979ff'], motion: 'burst', overlay: 'disco', count: 20, size: 18 },
  { id: 'solar_eclipse', label: 'pfx.solar_eclipse', chars: ['·', '✦'], colors: ['#ffd54f', '#ffffff'], motion: 'twinkle', overlay: 'moon', count: 14, size: 7 },
  { id: 'comets', label: 'pfx.comets', chars: ['☄'], colors: ['#7df9ff', '#ffffff'], motion: 'diagonal', overlay: 'galaxy', count: 5, size: 24 },
  { id: 'wishing_stars', label: 'pfx.wishing_stars', chars: ['★', '☆'], colors: ['#fff176', '#ffffff'], motion: 'rise', count: 14, size: 12 },
  { id: 'moon_phases', label: 'pfx.moon_phases', chars: ['◐', '◑', '◒', '◓', '●', '○'], colors: ['#e2ebf0', '#cfd9df'], motion: 'drift', overlay: 'moon', count: 12, size: 14 },
  { id: 'dreamy', label: 'pfx.dreamy', chars: ['·', '∘'], colors: ['#ffc8dd', '#bde0fe'], motion: 'float', overlay: 'mist', count: 16, size: 10 },
  { id: 'heat_wave', label: 'pfx.heat_wave', chars: [], colors: [], motion: 'twinkle', overlay: 'heat', count: 0 },
  { id: 'magma_glow', label: 'pfx.magma_glow', chars: [], colors: [], motion: 'twinkle', overlay: 'lava', count: 0 },
]

export const FX_GROUPS_EXTRA: { id: string; label: Key; ids: string[] }[] = [
  { id: 'creatures', label: 'pfx.group.creatures', ids: ['birds', 'doves', 'fish_school', 'jellyfish', 'ladybugs', 'bees'] },
  { id: 'food', label: 'pfx.group.food', ids: ['donuts', 'popcorn', 'sprinkles', 'cookies', 'boba', 'sugar_rush', 'coffee'] },
  { id: 'symbols', label: 'pfx.group.symbols', ids: ['zodiac', 'peace', 'astral', 'music_wave', 'ankhs', 'mystery', 'arrows', 'royalty'] },
  { id: 'lights', label: 'pfx.group.lights', ids: ['bokeh', 'prism_light', 'candlelight', 'neon_glow', 'laser_show', 'solar_eclipse', 'comets', 'wishing_stars', 'moon_phases', 'dreamy', 'heat_wave', 'magma_glow'] },
]
