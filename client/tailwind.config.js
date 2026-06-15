/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        fc: {
          bg: '#1a1b1e',
          sidebar: '#1e2124',
          channel: '#232428',
          chat: '#36393f',
          input: '#40444b',
          accent: '#5865f2',
          hover: '#2c2f33',
          text: '#dcddde',
          muted: '#72767d',
          green: '#3ba55c',
          red: '#ed4245',
          yellow: '#faa81a',
        },
      },
    },
  },
  plugins: [],
}
