// Import / export de thèmes sur mobile (amélioration n° 42).
import { newCustomId, studioWithImport } from '@/features/appearance/themeShare'
import { encodeTheme, findTheme } from '@/theme/themeCore'

test('le code du web devient un thème du compte, le reste du studio est gardé', () => {
  const dark = findTheme('dark')!
  const code = encodeTheme({ ...dark, name: 'Mon thème' })
  const r = studioWithImport({ layout: { members: 'left' }, customs: [] }, [], code)!
  expect(r.theme.name).toBe('Mon thème')
  expect(r.theme.id).toMatch(/^c-[a-z0-9]+$/)
  expect(r.studio.layout).toEqual({ members: 'left' })
  expect((r.studio.customs as unknown[]).length).toBe(1)
  expect(studioWithImport(null, [], 'pas un thème')).toBeNull()
  expect(newCustomId(0, 0)).toBe('c-00000')
})
