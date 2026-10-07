import { useEffect, useRef, useState } from 'react'
import { Camera, Trash2 } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api, { mediaUrl } from '../../api/client'
import { useAuth } from '../../store/auth'
import { Field } from '../settings/shared'
import { useT } from '../../i18n'

type ImageKind = 'avatar' | 'banner'

/** « Mon profil sur ce serveur » : surnom, avatar, bannière et bio visibles
 *  uniquement ici. Vide = profil du compte. */
export default function MyServerProfileTab({ serverId }: { serverId: string }) {
  const t = useT()
  const qc = useQueryClient()
  const me = useAuth(s => s.user)
  const avatarRef = useRef<HTMLInputElement>(null)
  const bannerRef = useRef<HTMLInputElement>(null)
  const { data: member } = useQuery({
    queryKey: ['member', serverId, me?.id],
    queryFn: () => api.get(`/servers/${serverId}/members/${me?.id}`).then(r => r.data),
    enabled: !!me,
  })
  const [nickname, setNickname] = useState('')
  const [bio, setBio] = useState('')
  useEffect(() => {
    if (!member) return
    setNickname(member.nickname ?? '')
    setBio(member.server_bio ?? '')
  }, [member])

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['member', serverId] })
    qc.invalidateQueries({ queryKey: ['members', serverId] })
  }
  const onError = (e: any) => toast.error(e.response?.data?.error ?? t('common.error'))

  const save = useMutation({
    mutationFn: () => Promise.all([
      api.patch(`/servers/${serverId}/nickname`, { nickname: nickname.trim() || null }),
      api.patch(`/servers/${serverId}/profile`, { bio: bio.trim() || null }),
    ]),
    onSuccess: () => { refresh(); toast.success(t('myProfile.saved')) },
    onError,
  })
  const upload = useMutation({
    mutationFn: ({ kind, file }: { kind: ImageKind; file: File }) => {
      const fd = new FormData()
      fd.append('file', file)
      return api.post(`/servers/${serverId}/profile/${kind}`, fd)
    },
    onSuccess: refresh,
    onError,
  })
  const clear = useMutation({
    mutationFn: (kind: ImageKind) => api.delete(`/servers/${serverId}/profile/${kind}`),
    onSuccess: refresh,
    onError,
  })

  if (!me) return null
  const avatar = member?.server_avatar ?? me.avatar
  const banner = member?.server_banner ?? me.banner
  const picker = (kind: ImageKind, ref: React.RefObject<HTMLInputElement>) => (
    <input
      ref={ref}
      type="file"
      accept="image/png,image/jpeg,image/gif,image/webp"
      className="hidden"
      onChange={e => {
        const file = e.target.files?.[0]
        if (file) upload.mutate({ kind, file })
        e.target.value = ''
      }}
    />
  )
  const removeBtn = (kind: ImageKind, label: string) => (
    <button
      onClick={e => { e.stopPropagation(); clear.mutate(kind) }}
      aria-label={label}
      title={label}
      className="absolute top-1.5 right-1.5 p-1 bg-black/60 rounded-full text-white hover:bg-red-600 transition"
    >
      <Trash2 size={11} />
    </button>
  )

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h2 className="text-xl font-bold text-white">{t('srv.tab.profile')}</h2>
        <p className="text-sm text-fc-muted mt-1">{t('myProfile.intro')}</p>
      </div>

      <Field label={t('myProfile.banner')} hint={t('myProfile.bannerHint')}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => bannerRef.current?.click()}
          onKeyDown={e => { if (e.key === 'Enter') bannerRef.current?.click() }}
          className="relative h-24 rounded-lg overflow-hidden cursor-pointer border border-fc-hover hover:border-fc-accent transition bg-fc-channel flex items-center justify-center"
        >
          {banner
            ? <img src={mediaUrl(banner)} alt="" className="w-full h-full object-cover" />
            : <Camera size={20} className="text-fc-muted" />}
          {member?.server_banner && removeBtn('banner', t('myProfile.resetBanner'))}
        </div>
        {picker('banner', bannerRef)}
      </Field>

      <Field label={t('myProfile.avatar')} hint={t('myProfile.avatarHint')}>
        <div className="relative w-20 h-20">
          <button
            onClick={() => avatarRef.current?.click()}
            aria-label={t('myProfile.changeAvatar')}
            className="w-20 h-20 rounded-full bg-fc-accent flex items-center justify-center text-3xl font-bold text-white overflow-hidden hover:opacity-80 transition"
          >
            {avatar
              ? <img src={mediaUrl(avatar)} alt="" className="w-full h-full object-cover" />
              : me.username.charAt(0).toUpperCase()}
          </button>
          {member?.server_avatar && removeBtn('avatar', t('myProfile.resetAvatar'))}
        </div>
        {picker('avatar', avatarRef)}
      </Field>

      <Field label={t('myProfile.nickname')} hint={t('myProfile.nicknameHint')}>
        <input
          value={nickname}
          onChange={e => setNickname(e.target.value)}
          maxLength={32}
          placeholder={me.username}
          aria-label={t('myProfile.nickname')}
          className="w-full bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white focus:border-fc-accent outline-none placeholder-fc-muted"
        />
      </Field>

      <Field label={t('settings.profile.bio')} hint={t('settings.profile.bioCount', { n: bio.length })}>
        <textarea
          value={bio}
          onChange={e => setBio(e.target.value)}
          maxLength={190}
          rows={3}
          placeholder={me.bio || t('myProfile.bioPh')}
          aria-label={t('settings.profile.bio')}
          className="w-full bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white resize-none focus:border-fc-accent outline-none placeholder-fc-muted"
        />
      </Field>

      <button
        onClick={() => save.mutate()}
        disabled={save.isPending}
        className="px-4 py-2 bg-fc-accent hover:bg-fc-accent/80 disabled:opacity-50 rounded text-white text-sm font-medium transition"
      >
        {t('common.record')}
      </button>
    </div>
  )
}
