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
      // Expo la laisse en avertissement : un hook après un return a fait planter l'ouverture des serveurs (1.23.0).
      'react-hooks/rules-of-hooks': 'error',
    },
  },
  {
    // Scripts Node (e2e contre un serveur local) : sortie console voulue, globales Node.
    files: ['scripts/**/*.mjs', 'scripts/**/*.js'],
    languageOptions: {
      globals: { process: 'readonly', Buffer: 'readonly', __dirname: 'readonly', require: 'readonly', module: 'writable' },
    },
    rules: {
      'no-console': 'off',
    },
  },
])
