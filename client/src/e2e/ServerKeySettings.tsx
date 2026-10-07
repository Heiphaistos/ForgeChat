// Clé de récupération d'un serveur (docs/CHIFFREMENT-E2E.md §11) : onglet
// « Chiffrement » des réglages du serveur et invite au propriétaire. Le code
// n'est affiché qu'une fois ; le contenu récupéré est déchiffré et exporté sur
// l'appareil, rien n'est renvoyé en clair à la plateforme.
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, KeyRound, Loader2, ShieldCheck, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useT, t as tr } from '../i18n'
import { useWs } from '../store/ws'
import { useAccountKey } from './accountKey'
import { RecoveryCodeModal } from './E2EGate'
import { createServerKey, getServerKey, recoverServer, regenerateServerRecovery, type RecoveredChannel } from './serverKey'
import { saveDecrypted } from './files'

const btnCls = 'px-3 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition disabled:opacity-50'
const ghostCls = 'px-3 py-2 bg-fc-hover hover:bg-fc-hover/70 text-white rounded text-sm transition disabled:opacity-50'

/** Message lisible d'une erreur de la clé du serveur. */
function errorText(e: unknown): string {
  const m = e instanceof Error ? e.message : ''
  if (m === 'NEED_CODE') return tr('e2e.serverKey.needCode')
  if (m === 'BAD_CODE') return tr('e2e.serverKey.badCode')
  if (m === 'E2E_LOCKED') return tr('e2e.send.locked')
  return (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? tr('common.error')
}

/** Code du serveur à afficher une fois (création ou nouveau code). */
function ServerCodeModal({ code, serverName, onDone }: { code: string; serverName: string; onDone: () => void }) {
  const t = useT()
  return (
    <RecoveryCodeModal code={code} onDone={onDone} texts={{
      title: t('e2e.serverKey.codeTitle'),
      desc: t('e2e.serverKey.codeDesc'),
      fileHeader: t('e2e.serverKey.fileHeader', { name: serverName }),
      fileName: 'forgechat-code-serveur.txt',
    }} />
  )
}

/** Fichier généré sur l'appareil (aucun envoi réseau). */
function saveFile(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  Object.assign(document.createElement('a'), { href: url, download: name }).click()
  URL.revokeObjectURL(url)
}

function exportText(channels: RecoveredChannel[]) {
  return channels.map(ch => [
    `# ${ch.name}`,
    ...ch.messages.map(m => `[${m.created_at}] ${m.author} : ${m.text ?? tr('e2e.serverKey.unreadable')}`
      + (m.files ?? []).map(f => `\n  📎 ${f.name} (${f.size} o)`).join('')),
  ].join('\n')).join('\n\n') + '\n'
}

/** Onglet « Chiffrement » : description pour tous, gestion de la clé pour le propriétaire. */
export default function ServerKeySettings({ serverId, serverName, isOwner }: { serverId: string; serverName: string; isOwner: boolean }) {
  const t = useT()
  const qc = useQueryClient()
  const on = useWs(s => s.on)
  const ready = useAccountKey(s => s.status) === 'ready'
  const { data: key, isLoading } = useQuery({
    queryKey: ['server_key', serverId],
    queryFn: () => getServerKey(serverId),
    enabled: isOwner,
  })
  useEffect(() => on('SERVER_KEY', (d: any) => {
    if (d.server_id === serverId) qc.invalidateQueries({ queryKey: ['server_key', serverId] })
  }), [on, qc, serverId])

  const [shownCode, setShownCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState('')
  const [askCode, setAskCode] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [recovered, setRecovered] = useState<RecoveredChannel[] | null>(null)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      if (e instanceof Error && (e.message === 'NEED_CODE' || e.message === 'BAD_CODE')) setAskCode(true)
      toast.error(errorText(e))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }
  const typed = code.trim() || undefined

  const create = () => run(async () => {
    setShownCode(await createServerKey(serverId))
    qc.invalidateQueries({ queryKey: ['server_key', serverId] })
  })
  const regenerate = () => run(async () => {
    setShownCode(await regenerateServerRecovery(serverId, typed))
    setCode('')
    setAskCode(false)
  })
  const recover = () => run(async () => {
    setRecovered(null)
    const out = await recoverServer(serverId, typed, (done, total) => setProgress({ done, total }))
    setRecovered(out)
    setCode('')
    setAskCode(false)
    toast.success(t('e2e.serverKey.recovered', { n: out.length }))
  })

  return (
    <div className="space-y-4 max-w-xl">
      <h3 className="text-white font-semibold flex items-center gap-2"><ShieldCheck size={18} className="text-green-400" aria-hidden />{t('e2e.serverKey.title')}</h3>
      <p className="text-sm text-fc-muted">{t('e2e.serverKey.desc')}</p>
      {!isOwner && <p className="text-sm text-fc-muted italic">{t('e2e.serverKey.ownerOnly')}</p>}
      {isOwner && !ready && <p className="text-sm text-fc-yellow">{t('e2e.send.locked')}</p>}
      {isOwner && isLoading && <Loader2 size={18} className="animate-spin text-fc-muted" aria-label={t('common.loading')} />}

      {isOwner && key && !key.exists && (
        <div className="space-y-2">
          <p className="text-sm text-white">{t('e2e.serverKey.none')}</p>
          <button type="button" onClick={create} disabled={busy || !ready} className={btnCls}>{t('e2e.serverKey.create')}</button>
        </div>
      )}

      {isOwner && key?.exists && (
        <div className="space-y-4">
          <p className="text-sm text-white flex items-center gap-2">
            <KeyRound size={14} className="text-green-400 flex-shrink-0" aria-hidden />
            <span>{t('e2e.serverKey.exists', { fp: (key.fingerprint ?? '').slice(0, 16) })}</span>
          </p>
          {askCode && (
            <input value={code} onChange={e => setCode(e.target.value)} autoComplete="off" spellCheck={false}
              placeholder={t('e2e.serverKey.codePlaceholder')} aria-label={t('e2e.serverKey.codePlaceholder')}
              className="w-full px-3 py-2 bg-fc-input rounded text-white text-sm font-mono outline-none focus:ring-2 focus:ring-fc-accent" />
          )}
          <div className="p-3 rounded-lg bg-fc-channel/50 border border-fc-hover space-y-2">
            <p className="text-sm text-white font-medium">{t('e2e.serverKey.regenerate')}</p>
            <p className="text-xs text-fc-muted">{t('e2e.serverKey.regenerateDesc')}</p>
            <button type="button" onClick={regenerate} disabled={busy || !ready} className={ghostCls}>{t('e2e.serverKey.regenerate')}</button>
          </div>
          <div className="p-3 rounded-lg bg-fc-channel/50 border border-fc-hover space-y-2">
            <p className="text-sm text-white font-medium">{t('e2e.serverKey.recover')}</p>
            <p className="text-xs text-fc-muted">{t('e2e.serverKey.recoverDesc')}</p>
            <button type="button" onClick={recover} disabled={busy || !ready} className={btnCls}>{t('e2e.serverKey.recover')}</button>
            {progress && (
              <p role="status" className="text-xs text-fc-muted flex items-center gap-2">
                <Loader2 size={12} className="animate-spin" aria-hidden />{t('e2e.serverKey.progress', progress)}
              </p>
            )}
            {recovered && (
              <div className="flex flex-wrap gap-2 pt-1">
                <span className="text-xs text-green-400 self-center">{t('e2e.serverKey.recovered', { n: recovered.length })}</span>
                <button type="button" className={ghostCls}
                  onClick={() => saveFile('forgechat-serveur.json', JSON.stringify(recovered, null, 2), 'application/json')}>
                  <Download size={14} className="inline mr-1" aria-hidden />{t('e2e.serverKey.exportJson')}
                </button>
                <button type="button" className={ghostCls}
                  onClick={() => saveFile('forgechat-serveur.txt', exportText(recovered), 'text/plain')}>
                  <Download size={14} className="inline mr-1" aria-hidden />{t('e2e.serverKey.exportText')}
                </button>
                {recovered.some(ch => ch.messages.some(m => m.files?.length)) && (
                  <button type="button" className={ghostCls} disabled={busy} onClick={() => run(async () => {
                    // Fichiers téléchargés puis déchiffrés ici, un par un, enregistrés sous leur vrai nom.
                    for (const ch of recovered) for (const m of ch.messages) for (const f of m.files ?? []) await saveDecrypted(f.url, f.entry)
                  })}>
                    <Download size={14} className="inline mr-1" aria-hidden />{t('e2e.serverKey.exportFiles')}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {shownCode && <ServerCodeModal code={shownCode} serverName={serverName} onDone={() => setShownCode(null)} />}
    </div>
  )
}

const LATER = 'fc_server_key_later'

/** Invite au propriétaire d'un serveur sans clé de récupération : une fois par session. */
export function ServerKeyPrompt({ serverId, serverName }: { serverId: string; serverName: string }) {
  const t = useT()
  const qc = useQueryClient()
  const ready = useAccountKey(s => s.status) === 'ready'
  const [later, setLater] = useState(() => {
    try { return sessionStorage.getItem(`${LATER}:${serverId}`) === '1' } catch { return false }
  })
  const [shownCode, setShownCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { data: key } = useQuery({
    queryKey: ['server_key', serverId],
    queryFn: () => getServerKey(serverId),
    enabled: ready && !later,
    staleTime: 5 * 60_000,
  })
  const dismiss = () => {
    setLater(true)
    try { sessionStorage.setItem(`${LATER}:${serverId}`, '1') } catch { /* session seule */ }
  }
  const create = async () => {
    setBusy(true)
    try {
      setShownCode(await createServerKey(serverId))
      qc.invalidateQueries({ queryKey: ['server_key', serverId] })
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  if (shownCode) return <ServerCodeModal code={shownCode} serverName={serverName} onDone={() => { setShownCode(null); dismiss() }} />
  if (later || !ready || !key || key.exists) return null
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 px-4 py-2 bg-fc-accent/10 border-b border-fc-accent/20 text-xs text-fc-text flex-shrink-0">
      <KeyRound size={14} className="text-fc-accent flex-shrink-0" aria-hidden />
      <span className="flex-1 min-w-[12rem]">{t('e2e.serverKey.prompt')}</span>
      <button type="button" onClick={create} disabled={busy} className="px-2.5 py-1 bg-fc-accent hover:bg-indigo-500 text-white rounded font-medium transition disabled:opacity-50">
        {t('e2e.serverKey.create')}
      </button>
      <button type="button" onClick={dismiss} className="px-2.5 py-1 text-fc-muted hover:text-white rounded transition flex items-center gap-1">
        <X size={12} aria-hidden />{t('e2e.serverKey.later')}
      </button>
    </div>
  )
}
