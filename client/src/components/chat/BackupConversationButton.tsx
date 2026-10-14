// Sauvegarde chiffrée d'une conversation (amélioration n° 30) : les messages chargés, déchiffrés
// sur l'appareil, sont rescellés par une phrase secrète (e2e/historyBackup.ts). Lecture hors
// ligne : page /sauvegarde.
import { useState } from 'react'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import { useChat } from '../../store/chat'
import { displayAttachments } from '../../e2e/files'
import { passwordProblem } from '../../e2e/authKdf'
import { sealBackup } from '../../e2e/historyBackup'
import { saveFile } from '../../lib/saveFile'
import { useT } from '../../i18n'

export default function BackupConversationButton({ channelId, channelName }: { channelId: string; channelName: string }) {
  const t = useT()
  const messages = useChat(s => s.messagesByChannel[channelId] ?? [])
  const [open, setOpen] = useState(false)
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [busy, setBusy] = useState(false)
  useEscapeKey(() => { if (!busy) setOpen(false) }, open)

  const run = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pass !== pass2) return toast.error(t('auth.passwordMismatch'))
    const problem = passwordProblem(pass)
    if (problem) return toast.error(problem)
    setBusy(true)
    try {
      const sorted = [...messages].sort((a, b) => a.created_at.localeCompare(b.created_at))
      const file = await sealBackup({
        conversation: channelName,
        exported_at: new Date().toISOString(),
        messages: sorted.map(m => ({
          at: m.created_at, author: m.author_username ?? '?', text: m.content ?? '',
          files: displayAttachments(m.attachments, m.e2e_body).map(a => a.filename ?? '').filter(Boolean),
        })),
      }, pass)
      const name = `forgechat-${channelName.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 40)}-${new Date().toISOString().slice(0, 10)}.fcbackup`
      if (await saveFile(file, name, 'application/json')) toast.success(t('backup.done', { n: sorted.length }))
      setOpen(false); setPass(''); setPass2('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button onClick={() => setOpen(true)} aria-label={t('backup.title')} title={t('backup.title')}
        className="p-1.5 text-fc-muted hover:text-white transition rounded hover:bg-fc-hover">
        <ShieldCheck size={18} aria-hidden />
      </button>
      {open && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => !busy && setOpen(false)}>
          <form role="dialog" aria-modal="true" aria-labelledby="backup-title" onSubmit={e => void run(e)} onClick={e => e.stopPropagation()}
            className="bg-fc-sidebar rounded-xl p-6 w-full max-w-md space-y-3">
            <h2 id="backup-title" className="text-lg font-bold text-white">{t('backup.title')}</h2>
            <p className="text-xs text-fc-muted">{t('backup.desc', { n: messages.length })}</p>
            <input type="password" autoComplete="new-password" value={pass} onChange={e => setPass(e.target.value)} aria-label={t('backup.pass')} placeholder={t('backup.pass')}
              className="w-full px-3 py-2 bg-fc-input rounded text-white" />
            <input type="password" autoComplete="new-password" value={pass2} onChange={e => setPass2(e.target.value)} aria-label={t('backup.pass2')} placeholder={t('backup.pass2')}
              className="w-full px-3 py-2 bg-fc-input rounded text-white" />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 rounded bg-fc-hover text-fc-muted text-sm">{t('common.cancel')}</button>
              <button type="submit" disabled={busy || !pass} className="px-3 py-1.5 rounded bg-fc-accent text-white text-sm disabled:opacity-50">
                {busy ? t('backup.sealing') : t('backup.save')}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
