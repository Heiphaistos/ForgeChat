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
      // exhaustive-deps en avertissement (audit C8, 2026-10-13) : visible dans l'éditeur et
      // avec `npx eslint src`, sans casser `npm run lint` (--quiet n'affiche que les erreurs) ;
      // l'existant en compte 85 (2026-10-13), à résorber au fil des modifications.
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
]
