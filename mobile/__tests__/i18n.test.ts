import { en } from '@/i18n/en'
import { fr } from '@/i18n/fr'
import * as panels from '@/i18n/parts/panels'
import * as server from '@/i18n/parts/server'
import * as serverSettings from '@/i18n/parts/serverSettings'
import * as settings from '@/i18n/parts/settings'
import * as social from '@/i18n/parts/social'
import * as stores from '@/i18n/parts/stores'
import * as e2e from '@/i18n/parts/e2e'
import * as community from '@/i18n/parts/community'
import * as messaging from '@/i18n/parts/messaging'
import { pickLang, translate } from '@/i18n/translate'

describe('translate', () => {
  it('prend la langue active, sinon le français, sinon la clé', () => {
    expect(translate({ a: 'Hello' }, { a: 'Bonjour', b: 'Salut' }, 'a')).toBe('Hello')
    expect(translate({ a: 'Hello' }, { a: 'Bonjour', b: 'Salut' }, 'b')).toBe('Salut')
    expect(translate({}, {}, 'inconnue')).toBe('inconnue')
  })

  it('remplace les variables connues et laisse les autres', () => {
    expect(translate({}, { k: '{n} non lus sur {total}' }, 'k', { n: 3 })).toBe('3 non lus sur {total}')
    expect(translate({ k: '{n} unread' }, {}, 'k', { n: 0 })).toBe('0 unread')
  })

  it('anglais : chaque clé existe en français et garde les mêmes variables', () => {
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join()
    for (const [key, text] of Object.entries(en)) {
      expect(Object.keys(fr)).toContain(key)
      expect(vars(text!)).toBe(vars(fr[key as keyof typeof fr]))
    }
  })

  it('lots : chaque clé porte le préfixe de son lot (le français ne doit pas être écrasé)', () => {
    // Un préfixe par lot, absent du dictionnaire commun : deux lots ne peuvent pas déclarer la même clé.
    const parts = { settings, server, serverSettings, social, panel: panels, store: stores, e2e, community, messaging }
    for (const [prefix, p] of Object.entries(parts)) {
      for (const k of Object.keys(p.fr)) expect(k.startsWith(`${prefix}.`)).toBe(true)
    }
  })
})

describe('pickLang', () => {
  it('fr pour toute locale française, anglais sinon', () => {
    expect(pickLang('fr')).toBe('fr')
    expect(pickLang('fr-CA')).toBe('fr')
    expect(pickLang('FR_be')).toBe('fr')
    expect(pickLang('en-US')).toBe('en')
    expect(pickLang('es')).toBe('en')
    expect(pickLang(null)).toBe('en')
    expect(pickLang(undefined)).toBe('en')
  })
})
