import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Trash2, Copy, Eye, EyeOff, Bug, ClipboardList } from 'lucide-react'
import { sendManualReport } from '../../lib/errorReporter'
import { useAuth } from '../../store/auth'
import api from '../../api/client'
import toast from 'react-hot-toast'
import { useT } from '../../i18n'

interface Props {
  user: any
}

export default function AdvancedSection({ user }: Props) {
  const t = useT()
  const nav = useNavigate()
  const { logout } = useAuth()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteInput, setDeleteInput] = useState('')
  const [deletePassword, setDeletePassword] = useState('')
  const [showDeletePw, setShowDeletePw] = useState(false)

  const deleteAccount = useMutation({
    mutationFn: () => api.delete('/users/me', { data: { password: deletePassword } }),
    onSuccess: async () => { await logout(); nav('/login') },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('settings.adv.deleteError')),
  })

  const [problem, setProblem] = useState('')
  const report = useMutation({
    mutationFn: async () => {
      if (!(await sendManualReport(problem))) throw new Error('envoi')
    },
    onSuccess: () => { setProblem(''); toast.success(t('settings.adv.reportThanks')) },
    onError: () => toast.error(t('settings.adv.reportError')),
  })
  // Lien visible seulement pour les comptes autorisés (le serveur répond 403 aux autres).
  const { isSuccess: isDiagAdmin } = useQuery({
    queryKey: ['admin-diagnostics-access'],
    queryFn: () => api.get('/admin/diagnostics', { params: { limit: 1 } }),
    retry: false,
    staleTime: 5 * 60_000,
  })

  const canConfirmDelete = deleteInput === user.username && deletePassword.length >= 8

  function resetDelete() {
    setConfirmDelete(false)
    setDeleteInput('')
    setDeletePassword('')
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-white mb-2">{t('settings.adv.cache')}</h3>
        <button
          onClick={() => { localStorage.clear(); toast.success(t('settings.adv.cacheCleared')); setTimeout(() => location.reload(), 800) }}
          className="px-4 py-2 bg-fc-hover text-white rounded-lg text-sm hover:bg-fc-hover/80 transition"
        >
          {t('settings.adv.clearCache')}
        </button>
      </div>

      <div className="border-t border-fc-hover pt-6">
        <h3 className="text-sm font-semibold text-white mb-1">{t('settings.adv.debug')}</h3>
        <div className="bg-fc-channel rounded-lg p-3 text-xs font-mono text-fc-muted space-y-1">
          <div>UserID: {user.id}</div>
          <div>Version: {__APP_VERSION__}</div>
          <div>UA: {navigator.userAgent.slice(0, 60)}...</div>
        </div>
        <button
          onClick={() => { navigator.clipboard.writeText(user.id); toast.success(t('common.idCopied')) }}
          className="mt-2 flex items-center gap-1.5 text-xs text-fc-muted hover:text-white transition"
        >
          <Copy size={12} /> {t('settings.adv.copyId')}
        </button>
      </div>

      <div className="border-t border-fc-hover pt-6">
        <h3 className="text-sm font-semibold text-white mb-1">{t('settings.adv.report')}</h3>
        <p className="text-xs text-fc-muted mb-2">
          {t('settings.adv.reportDesc')}
        </p>
        <textarea
          value={problem}
          onChange={e => setProblem(e.target.value)}
          maxLength={2000}
          rows={3}
          placeholder={t('settings.adv.reportPlaceholder')}
          aria-label={t('settings.adv.reportLabel')}
          className="w-full bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white focus:border-fc-accent outline-none resize-y"
        />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            onClick={() => report.mutate()}
            disabled={report.isPending || !problem.trim()}
            className="flex items-center gap-1.5 px-4 py-2 bg-fc-accent text-white rounded-lg text-sm disabled:opacity-50 transition hover:bg-indigo-500"
          >
            <Bug size={14} /> {report.isPending ? t('common.sending') : t('settings.adv.sendReport')}
          </button>
          {isDiagAdmin && (
            <button
              onClick={() => nav('/admin/diagnostics')}
              className="flex items-center gap-1.5 text-xs text-fc-muted hover:text-white transition"
            >
              <ClipboardList size={12} /> {t('settings.adv.errorReports')}
            </button>
          )}
          {isDiagAdmin && (
            <button
              onClick={() => nav('/admin/signalements')}
              className="flex items-center gap-1.5 text-xs text-fc-muted hover:text-white transition"
            >
              <ClipboardList size={12} /> {t('settings.adv.dmReports')}
            </button>
          )}
        </div>
      </div>

      <div className="border-t border-fc-hover pt-6">
        <h3 className="text-sm font-semibold text-fc-red mb-1">{t('settings.adv.danger')}</h3>
        <p className="text-xs text-fc-muted mb-3">{t('settings.adv.dangerDesc')}</p>

        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="flex items-center gap-2 px-4 py-2 bg-fc-red/10 text-fc-red rounded-lg text-sm hover:bg-fc-red/20 transition"
          >
            <Trash2 size={14} /> {t('settings.adv.deleteAccount')}
          </button>
        ) : (
          <div className="space-y-3 p-4 border border-fc-red/40 rounded-xl">
            <p className="text-sm text-white">{t('settings.adv.typeBefore')}<strong>{user.username}</strong>{t('settings.adv.typeAfter')}</p>
            <input
              value={deleteInput}
              onChange={e => setDeleteInput(e.target.value)}
              placeholder={t('settings.account.username')}
              enterKeyHint="next"
              autoCapitalize="none"
              autoComplete="off"
              className="w-full bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white focus:border-fc-red outline-none"
            />
            <div className="relative">
              <input
                type={showDeletePw ? 'text' : 'password'}
                value={deletePassword}
                onChange={e => setDeletePassword(e.target.value)}
                placeholder={t('auth.password')}
                autoComplete="current-password"
                enterKeyHint="done"
                className="w-full bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 pr-10 text-sm text-white focus:border-fc-red outline-none"
              />
              <button
                type="button"
                onClick={() => setShowDeletePw(v => !v)}
                tabIndex={-1}
                aria-label={showDeletePw ? t('auth.hidePassword') : t('auth.showPassword')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-fc-muted hover:text-white transition"
              >
                {showDeletePw ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <div className="flex gap-2">
              <button onClick={resetDelete}
                className="flex-1 py-2 border border-fc-hover text-fc-muted rounded-lg text-sm hover:text-white transition">
                {t('common.cancel')}
              </button>
              <button
                onClick={() => deleteAccount.mutate()}
                disabled={!canConfirmDelete || deleteAccount.isPending}
                className="flex-1 py-2 bg-fc-red text-white rounded-lg text-sm disabled:opacity-50 transition hover:bg-fc-red/80"
              >
                {deleteAccount.isPending ? t('common.deleting') : t('settings.adv.deleteForever')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
