// Réglages « Système » de l'application de bureau (cachés sur le web) : démarrage,
// bouton fermer, accélération matérielle, téléchargements, glisser-déposer,
// raccourcis clavier, détection d'un logiciel de stream. Stockés côté Rust
// (desktop/src-tauri/src/systeme.rs), sauf le glisser-déposer (propre à la page).
import { useEffect, useState, type ReactNode } from 'react'
import toast from 'react-hot-toast'
import { useT } from '../../i18n'
import { desktopInvoke, errText } from '../../lib/desktop'
import { dragDropEnabled, setDragDropEnabled } from '../../lib/dragDropGuard'
import { isStreamingSoftwareRunning } from '../../lib/streamingSoftware'
import { Select, Toggle } from './shared'
import { forgetRememberedLogin, sessionStorageStatus } from '../../lib/localSession'
import { rememberOnDevice, setRememberOnDevice } from '../../store/auth'

interface SystemState {
  close_to_tray: boolean
  start_minimized: boolean
  hardware_acceleration: boolean
  ask_save: boolean
  download_dir: string | null
  autostart: boolean
  /** `windows`, `linux`, `macos` */
  platform: string
}
type Patch = Partial<Pick<SystemState, 'close_to_tray' | 'start_minimized' | 'hardware_acceleration' | 'ask_save'>>

const H = ({ children }: { children: ReactNode }) => (
  <h3 className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-3">{children}</h3>
)
const Row = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover flex items-center justify-between gap-4">
    <div className="min-w-0">
      <div className="text-sm text-fc-text">{label}</div>
      {hint && <div className="text-xs text-fc-muted mt-0.5">{hint}</div>}
    </div>
    <div className="flex-shrink-0">{children}</div>
  </div>
)
const btn = 'px-3 py-1.5 rounded-lg text-sm border border-fc-hover text-fc-text hover:bg-fc-hover transition'

export default function SystemSection({ onOpenKeybindings }: { onOpenKeybindings: () => void }) {
  const t = useT()
  const [sys, setSys] = useState<SystemState | null>(null)
  const [gpuAtStart, setGpuAtStart] = useState<boolean | null>(null)
  const [dnd, setDnd] = useState(dragDropEnabled)
  const [stream, setStream] = useState<boolean | null>(null)
  const [vault, setVault] = useState<string | null>(null)
  const [remember, setRemember] = useState(rememberOnDevice)

  useEffect(() => {
    desktopInvoke<SystemState>('system_get')
      .then(s => { setSys(s); setGpuAtStart(s.hardware_acceleration) })
      .catch(e => toast.error(t('system.error', { e: errText(e) })))
    void isStreamingSoftwareRunning().then(setStream)
    void sessionStorageStatus().then(setVault)
  }, [t])

  if (!sys) return null

  const fail = (e: unknown) => toast.error(t('system.error', { e: errText(e) }))
  const update = (patch: Patch) => {
    setSys({ ...sys, ...patch })
    desktopInvoke<Omit<SystemState, 'autostart' | 'platform'>>('system_set', { patch })
      .then(c => setSys(s => s && { ...s, ...c }))
      .catch(e => { setSys(sys); fail(e) })
  }
  const setAutostart = (enabled: boolean) => {
    desktopInvoke<boolean>('system_set_autostart', { enabled })
      .then(autostart => setSys(s => s && { ...s, autostart }))
      .catch(fail)
  }
  const pickDir = () => {
    desktopInvoke<string | null>('pick_download_dir')
      .then(dir => { if (dir) setSys(s => s && { ...s, download_dir: dir }) })
      .catch(fail)
  }
  const clearDir = () => {
    desktopInvoke('clear_download_dir').then(() => setSys(s => s && { ...s, download_dir: null })).catch(fail)
  }
  const restart = () => { void desktopInvoke('restart_app').catch(fail) }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <H>{t('system.startup.title')}</H>
        <Row label={t('system.autostart')}><Toggle value={sys.autostart} onChange={setAutostart} label={t('system.autostart')} /></Row>
        <Row label={t('system.startMinimized')}>
          <Toggle value={sys.start_minimized} onChange={v => update({ start_minimized: v })} label={t('system.startMinimized')} />
        </Row>
      </section>

      <section>
        <H>{t('system.close.title')}</H>
        <Select
          className="w-full"
          value={sys.close_to_tray ? 'tray' : 'quit'}
          onChange={v => update({ close_to_tray: v === 'tray' })}
          options={[
            { value: 'tray', label: t('system.close.tray') },
            { value: 'quit', label: t('system.close.quit') },
          ]}
        />
      </section>

      {/* macOS : WKWebView n'offre aucun moyen de couper le GPU. */}
      {sys.platform !== 'macos' && (
        <section className="space-y-2">
          <H>{t('system.gpu.title')}</H>
          <Row label={t('system.gpu.label')} hint={t('system.gpu.hint')}>
            <Toggle value={sys.hardware_acceleration} onChange={v => update({ hardware_acceleration: v })} label={t('system.gpu.label')} />
          </Row>
          {gpuAtStart !== null && gpuAtStart !== sys.hardware_acceleration && (
            <div role="status" className="p-3 rounded-xl border border-fc-accent/40 bg-fc-accent/10 flex items-center justify-between gap-3">
              <span className="text-sm text-fc-text">{t('system.restartNeeded')}</span>
              <button type="button" onClick={restart} className="px-3 py-1.5 rounded-lg text-sm bg-fc-accent text-white">
                {t('system.restartNow')}
              </button>
            </div>
          )}
        </section>
      )}

      <section className="space-y-2">
        <H>{t('system.downloads.title')}</H>
        <Row label={t('system.downloads.ask')}>
          <Toggle value={sys.ask_save} onChange={v => update({ ask_save: v })} label={t('system.downloads.ask')} />
        </Row>
        <Row label={t('system.downloads.dir')} hint={sys.download_dir ?? t('system.downloads.none')}>
          <div className="flex gap-2">
            <button type="button" onClick={pickDir} className={btn}>{t('system.downloads.choose')}</button>
            {sys.download_dir && <button type="button" onClick={clearDir} className={btn}>{t('system.downloads.clear')}</button>}
          </div>
        </Row>
      </section>

      <section className="space-y-2">
        <H>{t('system.session.title')}</H>
        <Row label={t('auth.login.rememberMe')} hint={t('system.session.rememberHint')}>
          <Toggle
            value={remember}
            onChange={v => { setRemember(v); setRememberOnDevice(v); if (!v) void forgetRememberedLogin() }}
            label={t('auth.login.rememberMe')}
          />
        </Row>
        {vault && (
          <Row label={t('system.session.vault')} hint={t(`system.session.vault.${vault === 'os' || vault === 'file' ? vault : 'memory'}`)}>
            <span className={`text-xs font-semibold ${vault === 'memory' ? 'text-red-400' : 'text-green-400'}`}>{vault === 'memory' ? '✗' : '✓'}</span>
          </Row>
        )}
      </section>

      <section>
        <H>{t('system.dnd.title')}</H>
        <Row label={t('system.dnd.label')} hint={t('system.dnd.hint')}>
          <Toggle value={dnd} onChange={v => { setDragDropEnabled(v); setDnd(v) }} label={t('system.dnd.label')} />
        </Row>
      </section>

      <section>
        <H>{t('system.keys.title')}</H>
        <button type="button" onClick={onOpenKeybindings} className={btn}>{t('system.keys.open')}</button>
      </section>

      <section>
        <H>{t('system.stream.title')}</H>
        <Row label={stream ? t('system.stream.yes') : t('system.stream.no')} hint={t('system.stream.hint')}>
          <button type="button" onClick={() => void isStreamingSoftwareRunning().then(setStream)} className={btn}>
            {t('system.stream.check')}
          </button>
        </Row>
      </section>
    </div>
  )
}
