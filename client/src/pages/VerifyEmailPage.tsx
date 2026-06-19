import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../store/auth'
import api from '../api/client'
import toast from 'react-hot-toast'

export default function VerifyEmailPage() {
  const location = useLocation()
  const nav = useNavigate()
  const { fetchMe } = useAuth()

  const email = (location.state as any)?.email ?? ''
  const devCode = (location.state as any)?.dev_code as string | undefined
  const [digits, setDigits] = useState(devCode ? devCode.split('') : ['', '', '', ''])
  const [loading, setLoading] = useState(false)
  const refs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ]

  useEffect(() => {
    if (!email) nav('/register')
    if (!devCode) refs[0].current?.focus()
  }, [])

  const handleDigit = (i: number, val: string) => {
    const d = val.replace(/\D/g, '').slice(-1)
    const next = [...digits]
    next[i] = d
    setDigits(next)
    if (d && i < 3) refs[i + 1].current?.focus()
  }

  const handleKeyDown = (i: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      refs[i - 1].current?.focus()
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4)
    if (pasted.length === 4) {
      setDigits(pasted.split(''))
      refs[3].current?.focus()
    }
  }

  const submit = async () => {
    const code = digits.join('')
    if (code.length !== 4) {
      toast.error('Entre les 4 chiffres')
      return
    }
    setLoading(true)
    try {
      const { data } = await api.post('/auth/verify-email', { email, code })
      localStorage.setItem('access_token', data.access_token)
      localStorage.setItem('refresh_token', data.refresh_token)
      await fetchMe()
      toast.success('Compte créé !')
      nav('/')
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Code invalide')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-fc-bg">
      <div className="bg-fc-channel p-8 rounded-lg shadow-xl w-full max-w-md text-center">
        <div className="w-16 h-16 bg-fc-accent/20 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-fc-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-white mb-2">Vérifie ton email</h1>

        {devCode ? (
          <div className="mb-6 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-left">
            <p className="text-yellow-400 text-xs font-medium mb-1">⚠ SMTP non configuré — mode self-hosted</p>
            <p className="text-fc-muted text-xs">Ton code est affiché directement ici. Configure SMTP pour envoyer de vrais emails.</p>
          </div>
        ) : (
          <p className="text-fc-muted text-sm mb-1">
            Un code de vérification a été envoyé à
          </p>
        )}
        <p className="text-fc-accent font-medium mb-6">{email}</p>

        <div className="flex justify-center gap-3 mb-6" onPaste={handlePaste}>
          {digits.map((d, i) => (
            <input
              key={i}
              ref={refs[i]}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={d}
              onChange={e => handleDigit(i, e.target.value)}
              onKeyDown={e => handleKeyDown(i, e)}
              className="w-14 h-16 text-center text-2xl font-bold bg-fc-input text-white rounded-lg
                         outline-none focus:ring-2 focus:ring-fc-accent transition caret-transparent"
            />
          ))}
        </div>

        <button
          onClick={submit}
          disabled={loading || digits.join('').length !== 4}
          className="w-full py-2.5 bg-fc-accent hover:bg-indigo-500 text-white font-medium rounded
                     transition disabled:opacity-50 mb-4"
        >
          {loading ? 'Vérification...' : 'Confirmer le compte'}
        </button>

        <p className="text-fc-muted text-sm">
          <button
            onClick={() => nav('/register')}
            className="text-fc-accent hover:underline"
          >
            ← Recommencer l'inscription
          </button>
        </p>
      </div>
    </div>
  )
}
