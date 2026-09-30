// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config')
const expoConfig = require('eslint-config-expo/flat')

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'node_modules/*', '.expo/*', 'android/*', 'ios/*'],
  },
  {
    rules: {
      // Pas de console.* en dur : passer par src/lib/logger.ts (redaction des secrets).
      'no-console': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
    },
  },
  {
    // Scripts Node (e2e contre un serveur local) : sortie console voulue, globales Node.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', Buffer: 'readonly' },
    },
    rules: {
      'no-console': 'off',
    },
  },
])
