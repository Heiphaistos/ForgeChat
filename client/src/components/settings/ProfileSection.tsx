import React, { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Camera, Trash2 } from 'lucide-react'
import { Field } from './shared'
import api from '../../api/client'
import toast from 'react-hot-toast'

interface Props {
  user: any
  updateMe: (d: any) => void
}

export default function ProfileSection({ user, updateMe }: Props) {
  const [bio, setBio] = useState(user.bio ?? '')
  const [pronouns, setPronouns] = useState(user.pronouns ?? '')
  const [bannerPreview, setBannerPreview] = useState<string | null>(user.banner ?? null)
  const fileRef = React.useRef<HTMLInputElement>(null)
  const bannerRef = React.useRef<HTMLInputElement>(null)

  const saveBio = useMutation({
    mutationFn: () => api.patch('/users/me', { bio, pronouns }),
    onSuccess: r => { updateMe(r.data); toast.success('Profil mis à jour') },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const uploadAvatar = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData()
      fd.append('avatar', file)
      return api.post('/users/me/avatar', fd)
    },
    onSuccess: r => { updateMe(r.data); toast.success('Avatar mis à jour') },
    onError: () => toast.error('Erreur upload avatar'),
  })

  const uploadBanner = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData()
      fd.append('banner', file)
      return api.post('/users/me/banner', fd)
    },
    onSuccess: r => {
      setBannerPreview(r.data.banner)
      updateMe({ ...user, banner: r.data.banner })
      toast.success('Bannière mise à jour')
    },
    onError: () => toast.error('Erreur upload bannière'),
  })

  return (
    <div className="space-y-6">
      {/* Bannière */}
      <div>
        <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">Bannière de profil</label>
        <div
          className="relative h-24 rounded-lg overflow-hidden cursor-pointer group border border-fc-hover hover:border-fc-accent transition"
          onClick={() => bannerRef.current?.click()}
        >
          {bannerPreview
            ? <img src={bannerPreview} alt="" className="w-full h-full object-cover" />
            : <div className="w-full h-full bg-fc-channel flex items-center justify-center">
                <div className="text-center">
                  <Camera size={20} className="text-fc-muted mx-auto mb-1" />
                  <p className="text-xs text-fc-muted">Cliquer pour ajouter une bannière</p>
                </div>
              </div>}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition flex items-center justify-center">
            <Camera size={20} className="text-white opacity-0 group-hover:opacity-100 transition" />
          </div>
          {bannerPreview && (
            <button
              onClick={e => { e.stopPropagation(); setBannerPreview(null); updateMe({ ...user, banner: null }); api.patch('/users/me', { banner: null }) }}
              className="absolute top-1.5 right-1.5 p-1 bg-black/60 rounded-full text-white opacity-0 group-hover:opacity-100 transition hover:bg-red-600"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
        <input
          ref={bannerRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) uploadBanner.mutate(file)
          }}
        />
        <p className="text-xs text-fc-muted mt-1">PNG, JPG, GIF ou WEBP · max 10 MB</p>
      </div>

      {/* Avatar */}
      <div className="flex items-center gap-4">
        <div className="relative">
          <div className="w-20 h-20 rounded-full bg-fc-accent flex items-center justify-center text-3xl font-bold text-white overflow-hidden">
            {user.avatar
              ? <img src={user.avatar} alt="" className="w-full h-full object-cover" />
              : user.username.charAt(0).toUpperCase()}
          </div>
          <button
            onClick={() => fileRef.current?.click()}
            className="absolute -bottom-1 -right-1 p-1.5 bg-fc-accent rounded-full text-white hover:bg-fc-accent/80 transition"
          >
            <Camera size={12} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) uploadAvatar.mutate(file)
            }}
          />
        </div>
        <div>
          <p className="text-sm font-medium text-white">{user.username}</p>
          <p className="text-xs text-fc-muted">Cliquez sur l'avatar pour le changer</p>
        </div>
      </div>

      <Field label="Bio" hint={`${bio.length}/190 caractères`}>
        <textarea
          value={bio}
          onChange={e => setBio(e.target.value)}
          maxLength={190}
          rows={3}
          placeholder="Décrivez-vous en quelques mots..."
          className="w-full bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white resize-none focus:border-fc-accent outline-none placeholder-fc-muted"
        />
      </Field>

      <Field label="Pronoms" hint="Ex : il/lui, elle/elle, iel/iel">
        <input
          value={pronouns}
          onChange={e => setPronouns(e.target.value)}
          maxLength={30}
          placeholder="il/lui"
          className="w-full bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white focus:border-fc-accent outline-none placeholder-fc-muted"
        />
      </Field>

      <button
        onClick={() => saveBio.mutate()}
        disabled={saveBio.isPending}
        className="px-5 py-2 bg-fc-accent hover:bg-fc-accent/80 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition"
      >
        {saveBio.isPending ? 'Sauvegarde...' : 'Sauvegarder le profil'}
      </button>
    </div>
  )
}
