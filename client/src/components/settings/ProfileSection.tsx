import React, { useState } from 'react'
import BirthdaySettings from './BirthdaySettings'
import { useMutation } from '@tanstack/react-query'
import { Camera, Trash2 } from 'lucide-react'
import { Field } from './shared'
import api, { mediaUrl } from '../../api/client'
import toast from 'react-hot-toast'
import ProfileCosmetics from './ProfileCosmetics'
import ProfileIdentity from './ProfileIdentity'
import { useT } from '../../i18n'

interface Props {
  user: any
  updateMe: (d: any) => void
}

export default function ProfileSection({ user, updateMe }: Props) {
  const t = useT()
  const [bio, setBio] = useState(user.bio ?? '')
  const [pronouns, setPronouns] = useState(user.pronouns ?? '')
  const [bannerPreview, setBannerPreview] = useState<string | null>(user.banner ?? null)
  const fileRef = React.useRef<HTMLInputElement>(null)
  const bannerRef = React.useRef<HTMLInputElement>(null)

  const saveBio = useMutation({
    mutationFn: () => api.patch('/users/me', { bio, pronouns }),
    onSuccess: r => { updateMe(r.data); toast.success(t('settings.account.profileUpdated')) },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('common.error')),
  })

  const uploadAvatar = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData()
      fd.append('avatar', file)
      return api.post('/users/me/avatar', fd)
    },
    onSuccess: r => { updateMe(r.data); toast.success(t('settings.profile.avatarUpdated')) },
    onError: () => toast.error(t('settings.profile.avatarError')),
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
      toast.success(t('settings.profile.bannerUpdated'))
    },
    onError: () => toast.error(t('settings.profile.bannerError')),
  })

  return (
    <div className="space-y-6">
      {/* Bannière */}
      <div>
        <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">{t('settings.profile.banner')}</label>
        <div
          className="relative h-24 rounded-lg overflow-hidden cursor-pointer group border border-fc-hover hover:border-fc-accent transition"
          onClick={() => bannerRef.current?.click()}
        >
          {bannerPreview
            ? <img src={mediaUrl(bannerPreview)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
            : <div className="w-full h-full bg-fc-channel flex items-center justify-center">
                <div className="text-center">
                  <Camera size={20} className="text-fc-muted mx-auto mb-1" />
                  <p className="text-xs text-fc-muted">{t('settings.profile.addBanner')}</p>
                </div>
              </div>}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition flex items-center justify-center">
            <Camera size={20} className="text-white opacity-0 group-hover:opacity-100 transition" />
          </div>
          {bannerPreview && (
            <button
              // `null` est ignoré par le serveur (colonne gardée) ; une chaîne vide efface la bannière.
              onClick={e => {
                e.stopPropagation()
                api.patch('/users/me', { banner: '' })
                  .then(() => { setBannerPreview(null); updateMe({ ...user, banner: null }) })
                  .catch((err: any) => toast.error(err.response?.data?.error ?? t('common.error')))
              }}
              aria-label={t('settings.profile.removeBanner')}
              className="absolute top-1.5 right-1.5 p-1 bg-black/60 rounded-full text-white opacity-100 md:opacity-0 md:group-hover:opacity-100 transition hover:bg-red-600"
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
        <p className="text-xs text-fc-muted mt-1">{t('settings.profile.bannerFormats')}</p>
      </div>

      {/* Avatar */}
      <div className="flex items-center gap-4">
        <div className="relative">
          <div className="w-20 h-20 rounded-full bg-fc-accent flex items-center justify-center text-3xl font-bold text-white overflow-hidden">
            {user.avatar
              ? <img src={mediaUrl(user.avatar)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
              : user.username.charAt(0).toUpperCase()}
          </div>
          <button
            onClick={() => fileRef.current?.click()}
            aria-label={t('settings.profile.changeAvatar')}
            className="absolute -bottom-1 -right-1 p-1.5 bg-fc-accent rounded-full text-white hover:bg-fc-accent/80 transition"
          >
            <Camera size={12} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/apng"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) uploadAvatar.mutate(file)
            }}
          />
        </div>
        <div>
          <p className="text-sm font-medium text-white">{user.username}</p>
          <p className="text-xs text-fc-muted">{t('settings.profile.avatarHint')}</p>
        </div>
      </div>

      <Field label={t('settings.profile.bio')} hint={t('settings.profile.bioCount', { n: bio.length })}>
        <textarea
          value={bio}
          onChange={e => setBio(e.target.value)}
          maxLength={190}
          rows={3}
          placeholder={t('settings.profile.bioPlaceholder')}
          enterKeyHint="done"
          autoCapitalize="sentences"
          className="w-full bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white resize-none focus:border-fc-accent outline-none placeholder-fc-muted streamer-blur"
        />
      </Field>

      <Field label={t('settings.profile.pronouns')} hint={t('settings.profile.pronounsHint')}>
        <input
          value={pronouns}
          onChange={e => setPronouns(e.target.value)}
          maxLength={30}
          placeholder={t('settings.profile.pronounsPlaceholder')}
          enterKeyHint="done"
          autoCapitalize="none"
          autoComplete="off"
          className="w-full bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white focus:border-fc-accent outline-none placeholder-fc-muted streamer-blur"
        />
      </Field>

      <button
        onClick={() => saveBio.mutate()}
        disabled={saveBio.isPending}
        className="px-5 py-2 bg-fc-accent hover:bg-fc-accent/80 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition"
      >
        {saveBio.isPending ? t('common.saving') : t('settings.profile.save')}
      </button>

      <BirthdaySettings />

      <ProfileIdentity user={user} updateMe={updateMe} />

      <ProfileCosmetics user={user} updateMe={updateMe} />
    </div>
  )
}
