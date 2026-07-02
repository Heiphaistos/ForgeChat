import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Eye, EyeOff } from 'lucide-react'
import { Field } from './shared'
import api from '../../api/client'
import toast from 'react-hot-toast'

interface Props {
  user: any
  updateMe: (d: any) => void
}

export default function AccountSection({ user, updateMe }: Props) {
  const [username, setUsername] = useState(user.username)
  const [showPwForm, setShowPwForm] = useState(false)
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [showOld, setShowOld] = useState(false)
  const [showNew, setShowNew] = useState(false)

  const saveProfile = useMutation({
    mutationFn: () => api.patch('/users/me', { username }),
    onSuccess: r => { updateMe(r.data); toast.success('Profil mis à jour') },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const changePw = useMutation({
    mutationFn: () => api.post('/auth/change-password', { old_password: oldPw, new_password: newPw }),
    onSuccess: () => { toast.success('Mot de passe modifié'); setShowPwForm(false); setOldPw(''); setNewPw('') },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Mot de passe incorrect'),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 p-4 bg-fc-channel rounded-xl border border-fc-hover">
        <div className="w-16 h-16 rounded-full bg-fc-accent flex items-center justify-center text-2xl font-bold text-white overflow-hidden flex-shrink-0">
          {user.avatar
            ? <img src={user.avatar} alt="" className="w-full h-full object-cover" />
            : user.username.charAt(0).toUpperCase()}
        </div>
        <div>
          <div className="font-semibold text-white">{user.username}</div>
          <div className="text-sm text-fc-muted">#{user.discriminator ?? '0000'}</div>
          <div className="text-xs text-fc-muted mt-0.5">{user.email}</div>
        </div>
      </div>

      <Field label="Nom d'utilisateur">
        <input
          value={username}
          onChange={e => setUsername(e.target.value)}
          className="w-full bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white focus:border-fc-accent outline-none"
        />
      </Field>

      <button
        onClick={() => saveProfile.mutate()}
        disabled={saveProfile.isPending || username === user.username}
        className="px-5 py-2 bg-fc-accent hover:bg-fc-accent/80 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition"
      >
        {saveProfile.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
      </button>

      <div className="border-t border-fc-hover pt-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Mot de passe</h3>
            <p className="text-xs text-fc-muted">Modifier votre mot de passe de connexion</p>
          </div>
          <button
            onClick={() => setShowPwForm(!showPwForm)}
            className="px-3 py-1.5 text-xs bg-fc-hover text-white rounded-lg hover:bg-fc-hover/80 transition"
          >
            {showPwForm ? 'Annuler' : 'Modifier'}
          </button>
        </div>

        {showPwForm && (
          <div className="space-y-3">
            {[
              { label: 'Mot de passe actuel', value: oldPw, setValue: setOldPw, show: showOld, toggle: () => setShowOld(!showOld), autoComplete: 'current-password' },
              { label: 'Nouveau mot de passe', value: newPw, setValue: setNewPw, show: showNew, toggle: () => setShowNew(!showNew), autoComplete: 'new-password' },
            ].map(field => (
              <Field key={field.label} label={field.label}>
                <div className="relative">
                  <input
                    type={field.show ? 'text' : 'password'}
                    value={field.value}
                    onChange={e => field.setValue(e.target.value)}
                    autoComplete={field.autoComplete}
                    className="w-full bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 pr-10 text-sm text-white focus:border-fc-accent outline-none"
                  />
                  <button
                    onClick={field.toggle}
                    className="absolute right-3 top-2.5 text-fc-muted hover:text-white transition"
                  >
                    {field.show ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </Field>
            ))}
            <button
              onClick={() => changePw.mutate()}
              disabled={changePw.isPending || !oldPw || !newPw}
              className="px-5 py-2 bg-fc-accent hover:bg-fc-accent/80 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition"
            >
              {changePw.isPending ? 'Modification...' : 'Changer le mot de passe'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
