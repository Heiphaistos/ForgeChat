import { readFileSync } from 'fs'
import { join } from 'path'
import { DECORATIONS, PROFILE_EFFECTS, profileTheme } from '@/features/account/profileDecor'

const root = join(__dirname, '..', '..')
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8')
/** Chaînes entre guillemets d'un `pub const NOM: &[&str] = &[...]` Rust. */
const rustList = (src: string, name: string) =>
  [...(src.split(`${name}: &[&str] = &[`)[1]?.split(']')[0] ?? '').matchAll(/"([^"]+)"/g)].map((m) => m[1])

describe('personnalisation du profil', () => {
  const server = read('server', 'src', 'models', 'user.rs')
  const web = read('client', 'src', 'components', 'ui', 'ProfileDecor.tsx')

  it('mêmes décorations et effets que la liste blanche du serveur', () => {
    expect(DECORATIONS.map((d) => d.id)).toEqual(rustList(server, 'AVATAR_DECORATIONS'))
    expect(PROFILE_EFFECTS.map((e) => e.id)).toEqual(rustList(server, 'PROFILE_EFFECTS'))
    expect(DECORATIONS.length).toBeGreaterThanOrEqual(12)
  })
  it('mêmes identifiants que le web', () => {
    for (const id of [...DECORATIONS, ...PROFILE_EFFECTS].map((d) => d.id)) expect(web).toContain(`id: '${id}'`)
  })
  it('thème : une seule couleur suffit, aucune = défaut', () => {
    expect(profileTheme(null, null)).toBeNull()
    expect(profileTheme(0xff0000, null)).toEqual({ top: '#ff0000', bottom: '#ff0000' })
    expect(profileTheme(0x00000a, 0x5865f2)).toEqual({ top: '#00000a', bottom: '#5865f2' })
  })
})
