import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../../api/client'
import { Shield } from 'lucide-react'
import QRCode from 'qrcode'

export default function SecuritySection() {
  const qc = useQueryClient()
  const [step, setStep] = useState<'idle' | 'setup' | 'confirm'>('idle')
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
    mutationFn: () => api.post('/auth/2fa/setup').then(r => r.data),
    onSuccess: (data) => { setSetupData(data); setStep('setup') },
  })

  const confirmMutation = useMutation({
    mutationFn: () => api.post('/auth/2fa/confirm', { code }).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['me'] }); setStep('idle'); setCode('') },
  })

  const disableMutation = useMutation({
    mutationFn: () => api.post('/auth/2fa/disable', { code }).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['me'] }); setStep('idle'); setCode('') },
  })

  const is2faEnabled = me?.totp_enabled ?? false

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between p-4 bg-fc-channel rounded-xl border border-fc-hover">
        <div className="flex items-center gap-3">
          <Shield size={20} className={is2faEnabled ? 'text-fc-green' : 'text-fc-muted'} />
          <div>
            <p className="text-sm font-medium text-white">Authentification à deux facteurs</p>
            <p className="text-xs text-fc-muted">
              {is2faEnabled ? 'Activée — votre compte est protégé' : 'Désactivée'}
            </p>
          </div>
        </div>
        {!is2faEnabled ? (
          <button
            onClick={() => setupMutation.mutate()}
            disabled={setupMutation.isPending}
            className="px-3 py-1.5 bg-fc-green/20 text-fc-green rounded-lg text-sm hover:bg-fc-green/30 disabled:opacity-50"
          >
            Activer
          </button>
        ) : (
          <button
            onClick={() => setStep('confirm')}
            className="px-3 py-1.5 bg-fc-red/20 text-fc-red rounded-lg text-sm hover:bg-fc-red/30"
          >
            Désactiver
          </button>
        )}
      </div>

      {step === 'setup' && setupData && (
        <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover space-y-4">
          <p className="text-sm text-white font-medium">1. Scannez ce QR code avec votre app d'authentification</p>
          <div className="bg-white p-4 rounded-lg inline-block">
            {qrDataUrl
              ? <img src={qrDataUrl} alt="QR 2FA" className="w-44 h-44" />
              : <div className="w-44 h-44 flex items-center justify-center text-xs text-gray-400">Chargement...</div>
            }
          </div>
          <p className="text-xs text-fc-muted">
            Ou entrez manuellement : <code className="bg-fc-hover px-1 rounded">{setupData.secret}</code>
          </p>
          <p className="text-sm text-white font-medium">2. Entrez le code généré par l'app</p>
          <input
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            maxLength={6}
            className="w-full bg-fc-hover border border-fc-hover rounded-lg px-3 py-2 text-white font-mono tracking-widest text-center text-lg"
          />
          <button
            onClick={() => confirmMutation.mutate()}
            disabled={code.length !== 6 || confirmMutation.isPending}
            className="w-full py-2 bg-fc-accent rounded-lg text-white font-medium disabled:opacity-50"
          >
            {confirmMutation.isPending ? 'Vérification...' : "Confirmer l'activation"}
          </button>
          {setupData.backup_codes.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-fc-hover">
              <p className="text-xs text-white font-medium">Codes de secours (conservez-les précieusement !) :</p>
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
          <p className="text-sm text-white">Entrez votre code 2FA pour désactiver :</p>
          <input
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            maxLength={6}
            className="w-full bg-fc-hover border border-fc-hover rounded-lg px-3 py-2 text-white font-mono tracking-widest text-center text-lg"
          />
          <div className="flex gap-2">
            <button
              onClick={() => { setStep('idle'); setCode('') }}
              className="flex-1 py-2 bg-fc-hover rounded-lg text-fc-muted text-sm"
            >
              Annuler
            </button>
            <button
              onClick={() => disableMutation.mutate()}
              disabled={code.length !== 6 || disableMutation.isPending}
              className="flex-1 py-2 bg-fc-red rounded-lg text-white font-medium disabled:opacity-50 text-sm"
            >
              Désactiver
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
