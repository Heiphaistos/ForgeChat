// « Apparence de ce serveur » : thème et style des catégories propres à un serveur, pour soi seul.
// Sans choix, le serveur reprend l'apparence de ForgeChat. Appliqué en direct, synchronisé avec le compte.
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useLang, useT } from '../../i18n'
import CategoryStyleEditor from '../settings/appearance/CategoryStyleEditor'
import { PRESETS, type ThemeSpec } from '../../theme/themeCore'
import { DEFAULT_CATEGORY } from '../../theme/serverLook'
import { useThemeStore } from '../../theme/themeStore'

function Swatch({ spec }: { spec: ThemeSpec }) {
  return (
    <span className="flex w-10 h-6 rounded overflow-hidden border border-fc-hover flex-shrink-0" aria-hidden>
      <span className="flex-1" style={{ background: spec.colors.sidebar }} />
      <span className="flex-1" style={{ background: spec.colors.chat }} />
      <span className="w-2" style={{ background: spec.colors.accent }} />
    </span>
  )
}

export default function ServerLookModal({ serverId, serverName, onClose }: { serverId: string; serverName: string; onClose: () => void }) {
  const t = useT()
  const lang = useLang(s => s.lang)
  const { servers, customs, category, setServerLook } = useThemeStore()
  const look = servers[serverId.toLowerCase()] ?? {}
  const themes = [
    ...customs.map(c => ({ id: c.id, name: c.name, spec: c as ThemeSpec })),
    ...PRESETS.map(p => ({ id: p.id, name: p.label[lang], spec: p.spec })),
  ]
  const setTheme = (theme: string | undefined) => setServerLook(serverId, { ...look, theme })
  const ownCategory = !!look.category

  // Portail vers <body> : ouvert depuis la barre des salons, dont un parent fixe le repère des éléments `fixed`.
  return createPortal(
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="server-look-title" onClick={e => e.stopPropagation()}
        className="bg-fc-channel rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl p-5 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="server-look-title" className="text-lg font-semibold text-white">{t('serverLook.title')}</h2>
            <p className="text-xs text-fc-muted">{t('serverLook.hint', { name: serverName })}</p>
          </div>
          <button onClick={onClose} aria-label={t('common.close')} className="p-1.5 rounded text-fc-muted hover:text-white hover:bg-fc-hover"><X size={18} /></button>
        </div>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-fc-text">{t('serverLook.theme')}</h3>
          <div role="radiogroup" aria-label={t('serverLook.theme')} className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-64 overflow-y-auto pr-1">
            <button role="radio" aria-checked={!look.theme} onClick={() => setTheme(undefined)}
              className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-sm text-left transition ${!look.theme ? 'border-fc-accent bg-fc-accent/10 text-fc-text' : 'border-fc-hover text-fc-muted hover:text-white'}`}>
              {t('serverLook.sameAsApp')}
            </button>
            {themes.map(th => (
              <button key={th.id} role="radio" aria-checked={look.theme === th.id} onClick={() => setTheme(th.id)}
                className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-sm text-left transition ${look.theme === th.id ? 'border-fc-accent bg-fc-accent/10 text-fc-text' : 'border-fc-hover text-fc-muted hover:text-white'}`}>
                <Swatch spec={th.spec} />
                <span className="truncate">{th.name}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-fc-text">{t('catStyle.title')}</h3>
          <label className="flex items-center gap-2 text-sm text-fc-text cursor-pointer">
            <input type="checkbox" checked={ownCategory} className="accent-fc-accent"
              onChange={e => setServerLook(serverId, { ...look, category: e.target.checked ? { ...category } : undefined })} />
            {t('serverLook.ownCategory')}
          </label>
          {ownCategory
            ? <CategoryStyleEditor value={look.category ?? DEFAULT_CATEGORY}
                onChange={patch => setServerLook(serverId, { ...look, category: { ...(look.category ?? DEFAULT_CATEGORY), ...patch } })} />
            : <p className="text-xs text-fc-muted">{t('serverLook.categoryFromApp')}</p>}
        </section>

        <div className="flex justify-between items-center pt-1">
          <button onClick={() => setServerLook(serverId, null)} className="text-sm text-fc-muted hover:text-white">{t('serverLook.reset')}</button>
          <button onClick={onClose} className="px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-sm font-medium">{t('common.close')}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
