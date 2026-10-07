// Couleurs fc-* = variables CSS posées par src/theme/applyTheme.ts (un thème = des données, pas du CSS).
// Les surfaces sont multipliées par --fc-surface-a : translucides au-dessus d'un dégradé ou d'une image.
const v = name => `rgb(var(--fc-${name}-rgb) / <alpha-value>)`
const surface = name => `rgb(var(--fc-${name}-rgb) / calc(<alpha-value> * var(--fc-surface-a, 1)))`
const r = rem => `calc(${rem}rem * var(--fc-radius, 1))`

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        fc: {
          bg: surface('bg'),
          sidebar: surface('sidebar'),
          channel: surface('channel'),
          chat: surface('chat'),
          input: surface('input'),
          hover: surface('hover'),
          accent: v('accent'),
          text: v('text'),
          muted: v('muted'),
          green: '#3ba55c',
          red: '#ed4245',
          yellow: '#faa81a',
        },
      },
      // border-fc-hover sert de séparateur : couleur de bordure dédiée du thème.
      borderColor: { fc: { hover: v('border') } },
      borderRadius: { DEFAULT: r(0.25), md: r(0.375), lg: r(0.5), xl: r(0.75), '2xl': r(1), '3xl': r(1.5) },
    },
  },
  plugins: [],
}
