import { useState } from 'react'
import { Link } from 'react-router-dom'
import { openBackup, type BackupPayload } from '../e2e/historyBackup'
import { intlLocale, useT } from '../i18n'

// Lecture d'une sauvegarde chiffrée (amélioration n° 30), sur l'appareil, sans compte ni réseau :
// le fichier et la phrase ne quittent pas le navigateur.
export default function BackupViewerPage() {
  const t = useT()
  const [file, setFile] = useState<File | null>(null)
  const [pass, setPass] = useState('')
  const [data, setData] = useState<BackupPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const open = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) return
    setBusy(true); setError(null)
    try {
      setData(await openBackup(await file.text(), pass))
      setPass('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen overflow-y-auto bg-fc-bg px-4 py-10">
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold text-white">{t('backup.viewer')}</h1>
        {!data ? (
          <form onSubmit={e => void open(e)} className="bg-fc-channel rounded-xl p-5 space-y-3">
            <p className="text-sm text-fc-muted">{t('backup.viewerDesc')}</p>
            <input type="file" accept=".fcbackup,application/json" onChange={e => setFile(e.target.files?.[0] ?? null)} aria-label={t('backup.file')} className="text-sm text-fc-text" />
            <input type="password" value={pass} onChange={e => setPass(e.target.value)} aria-label={t('backup.pass')} placeholder={t('backup.pass')}
              className="w-full px-3 py-2 bg-fc-input rounded text-white" />
            {error && <p role="alert" className="text-sm text-fc-red">{error}</p>}
            <button type="submit" disabled={!file || !pass || busy} className="px-4 py-2 rounded bg-fc-accent text-white text-sm disabled:opacity-50">
              {busy ? t('backup.opening') : t('backup.open')}
            </button>
          </form>
        ) : (
          <section aria-label={data.conversation} className="bg-fc-channel rounded-xl p-5 space-y-3">
            <h2 className="text-lg text-white font-semibold">{data.conversation}</h2>
            <p className="text-xs text-fc-muted">{t('backup.exportedOn', { when: new Date(data.exported_at).toLocaleString(intlLocale()) })} · {data.messages.length}</p>
            <ol className="space-y-2">
              {data.messages.map((m, i) => (
                <li key={i} className="text-sm">
                  <span className="text-fc-muted">{new Date(m.at).toLocaleString(intlLocale(), { dateStyle: 'short', timeStyle: 'short' })}</span>{' '}
                  <span className="text-white font-medium">{m.author}</span>{' '}
                  <span className="text-fc-text whitespace-pre-wrap">{m.text}</span>
                  {!!m.files?.length && <span className="text-fc-muted"> 📎 {m.files.join(', ')}</span>}
                </li>
              ))}
            </ol>
            <button onClick={() => setData(null)} className="text-sm text-fc-muted hover:text-white">{t('backup.close')}</button>
          </section>
        )}
        <Link to="/" className="text-sm text-fc-accent">← ForgeChat</Link>
      </div>
    </div>
  )
}
