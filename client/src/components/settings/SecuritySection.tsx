import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../../api/client'
import { Shield } from 'lucide-react'
import QRCode from 'qrcode'
import toast from 'react-hot-toast'
import { useT } from '../../i18n'
import { E2EKeySection } from '../../e2e/E2ESettings'
import { askPasswordProof } from '../ui/PasswordPrompt'
import AppLockSection from './AppLockSection'
import PasskeysSection from './PasskeysSection'

export default function SecuritySection() {
  const t = useT()
  const qc = useQueryClient()
  const [step, setStep] = useState<'idle' | 'setup' | 'confirm' | 'regen'>('idle')
  const [code, setCode] = useState('')
  const [setupData, setSetupData] = useState<{ secret: string; qr_url: string; backup_codes: string[] } | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!setupData?.qr_url) { setQrDataUrl(null); return }
    QRCode.toDataURL(setupData.qr_url, { width: 180, margin: 1 })
      .then(url => setQrDataUrl(url))
      .catch(() => setQrDataUrl(null))
  }, [setupData?.qr_url])

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get('/users/me').then(r => r.data),
    staleTime: 60_000,
  })

  const setupMutation = useMutation({
    mutationFn: async () => {
      const proof = await askPasswordProof(t('pwp.2fa'))
      if (!proof) throw new Error('CANCELLED')
      return api.post('/auth/2fa/setup', proof).then(r => r.data)
    },
    onSuccess: (data) => { setSetupData(data); setStep('setup') },
    onError: (e: any) => { if (e?.message !== 'CANCELLED') toast.error(e.response?.data?.error ?? t('settings.security.setupError')) },
  })

  const confirmMutation = useMutation({
    mutationFn: () => api.post('/auth/2fa/confirm', { code }).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['me'] }); setStep('idle'); setCode('') },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('settings.security.invalidCode')),
  })

  const disableMutation = useMutation({
    mutationFn: () => api.post('/auth/2fa/disable', { code }).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['me'] }); setStep('idle'); setCode('') },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('settings.security.invalidCode')),
  })

  const is2faEnabled = me?.totp_enabled ?? false

  // Codes de secours (amélioration n° 4) : nombre restant, régénération avec un code valide.
  const { data: totpStatus } = useQuery<{ enabled: boolean; backup_codes_left: number }>({
    queryKey: ['2fa-status'],
    queryFn: () => api.get('/auth/2fa/status').then(r => r.data),
    enabled: is2faEnabled,
    staleTime: 60_000,
  })
  const [newCodes, setNewCodes] = useState<string[] | null>(null)
  const regenMutation = useMutation({
    mutationFn: () => api.post('/auth/2fa/backup-codes', { code }).then(r => r.data as { backup_codes: string[] }),
    onSuccess: data => {
      setNewCodes(data.backup_codes); setStep('idle'); setCode('')
      qc.invalidateQueries({ queryKey: ['2fa-status'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('settings.security.invalidCode')),
  })

  return (
    <div className="space-y-6">
      <E2EKeySection />
      <AppLockSection />
      <div className="flex items-center justify-between p-4 bg-fc-channel rounded-xl border border-fc-hover">
        <div className="flex items-center gap-3">
          <Shield size={20} className={is2faEnabled ? 'text-fc-green' : 'text-fc-muted'} />
          <div>
            <p className="text-sm font-medium text-white">{t('settings.security.twoFa')}</p>
            <p className="text-xs text-fc-muted">
              {is2faEnabled ? t('settings.security.on') : t('settings.security.off')}
            </p>
          </div>
        </div>
        {!is2faEnabled ? (
          <button
            onClick={() => setupMutation.mutate()}
            disabled={setupMutation.isPending}
            className="px-3 py-1.5 bg-fc-green/20 text-fc-green rounded-lg text-sm hover:bg-fc-green/30 disabled:opacity-50"
          >
            {t('settings.security.enable')}
          </button>
        ) : (
          <button
            onClick={() => setStep('confirm')}
            className="px-3 py-1.5 bg-fc-red/20 text-fc-red rounded-lg text-sm hover:bg-fc-red/30"
          >
            {t('settings.security.disable')}
          </button>
        )}
      </div>

      {is2faEnabled && totpStatus && (
        <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-white">{t('guard.backup.left', { n: totpStatus.backup_codes_left })}</p>
              {totpStatus.backup_codes_left <= 3 && <p className="text-xs text-fc-yellow">{t('guard.backup.low')}</p>}
            </div>
            <button
              onClick={() => { setNewCodes(null); setStep('regen'); setCode('') }}
              className="px-3 py-1.5 bg-fc-hover rounded-lg text-sm text-white hover:bg-fc-accent/30 flex-shrink-0"
            >
              {t('guard.backup.regen')}
            </button>
          </div>
          {step === 'regen' && (
            <div className="space-y-2">
              <p className="text-xs text-fc-muted">{t('guard.backup.prompt')}</p>
              <input
                value={code}
                onChange={e => setCode(e.target.value.replace(/[^0-9a-fA-F-]/g, '').slice(0, 19))}
                placeholder="000000"
                aria-label={t('settings.security.codeLabel')}
                autoComplete="one-time-code"
                className="w-full bg-fc-hover border border-fc-hover rounded-lg px-3 py-2 text-white font-mono tracking-widest text-center"
              />
              <div className="flex gap-2">
                <button onClick={() => { setStep('idle'); setCode('') }} className="flex-1 py-2 bg-fc-hover rounded-lg text-fc-muted text-sm">
                  {t('common.cancel')}
                </button>
                <button
                  onClick={() => regenMutation.mutate()}
                  disabled={code.length < 6 || regenMutation.isPending}
                  className="flex-1 py-2 bg-fc-accent rounded-lg text-white text-sm font-medium disabled:opacity-50"
                >
                  {t('guard.backup.regen')}
                </button>
              </div>
            </div>
          )}
          {newCodes && (
            <div className="space-y-2 pt-2 border-t border-fc-hover">
              <p className="text-xs text-white font-medium">{t('guard.backup.new')}</p>
              <div className="grid grid-cols-2 gap-1">
                {newCodes.map(c => (
                  <code key={c} className="text-xs bg-fc-hover px-2 py-1 rounded font-mono text-fc-text">{c}</code>
                ))}
              </div>
              <button
                onClick={() => navigator.clipboard.writeText(newCodes.join('\n')).then(() => toast.success(t('guard.backup.copied')))}
                className="text-xs text-fc-accent hover:underline"
              >
                {t('guard.backup.copy')}
              </button>
            </div>
          )}
        </div>
      )}

      {is2faEnabled && <PasskeysSection />}

      {step === 'setup' && setupData && (
        <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover space-y-4">
          <p className="text-sm text-white font-medium">{t('settings.security.step1')}</p>
          <div className="bg-white p-4 rounded-lg inline-block">
            {qrDataUrl
              ? <img src={qrDataUrl} alt="QR 2FA" className="w-44 h-44" />
              : <div className="w-44 h-44 flex items-center justify-center text-xs text-gray-400">{t('common.loading')}</div>
            }
          </div>
          <p className="text-xs text-fc-muted">
            {t('settings.security.manual')} <code className="bg-fc-hover px-1 rounded">{setupData.secret}</code>
          </p>
          <p className="text-sm text-white font-medium">{t('settings.security.step2')}</p>
          <input
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            maxLength={6}
            enterKeyHint="done"
            inputMode="numeric"
            autoComplete="one-time-code"
            className="w-full bg-fc-hover border border-fc-hover rounded-lg px-3 py-2 text-white font-mono tracking-widest text-center text-lg"
          />
          <button
            onClick={() => confirmMutation.mutate()}
            disabled={code.length !== 6 || confirmMutation.isPending}
            className="w-full py-2 bg-fc-accent rounded-lg text-white font-medium disabled:opacity-50"
          >
            {confirmMutation.isPending ? t('settings.security.verifying') : t('settings.security.confirm')}
          </button>
          {setupData.backup_codes.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-fc-hover">
              <p className="text-xs text-white font-medium">{t('settings.security.backup')}</p>
              <div className="grid grid-cols-2 gap-1">
                {setupData.backup_codes.map(c => (
                  <code key={c} className="text-xs bg-fc-hover px-2 py-1 rounded font-mono text-fc-text">{c}</code>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {step === 'confirm' && (
        <div className="p-4 bg-fc-channel rounded-xl border border-fc-red/30 space-y-3">
          <p className="text-sm text-white">{t('settings.security.disablePrompt')}</p>
          <input
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            maxLength={6}
            aria-label={t('settings.security.codeLabel')}
            className="w-full bg-fc-hover border border-fc-hover rounded-lg px-3 py-2 text-white font-mono tracking-widest text-center text-lg"
          />
          <div className="flex gap-2">
            <button
              onClick={() => { setStep('idle'); setCode('') }}
              className="flex-1 py-2 bg-fc-hover rounded-lg text-fc-muted text-sm"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={() => disableMutation.mutate()}
              disabled={code.length !== 6 || disableMutation.isPending}
              className="flex-1 py-2 bg-fc-red rounded-lg text-white font-medium disabled:opacity-50 text-sm"
            >
              {t('settings.security.disable')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
