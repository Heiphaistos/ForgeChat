// Config ESLint minimale, focalisée sur les Rules of Hooks — la classe de bug
// qui a causé les crashs React #300/#310 (hooks après return conditionnel)
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      // exhaustive-deps volontairement off : trop de faux positifs sur
      // l'existant ; rules-of-hooks est la règle anti-crash critique
    },
  },
]
