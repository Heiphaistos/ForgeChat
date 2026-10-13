import React, { useCallback, useEffect, useState } from 'react'
import BirthdaySettings from './BirthdaySettings'
import { useMutation } from '@tanstack/react-query'
import { Camera, Trash2 } from 'lucide-react'
import { Field } from './shared'
import api, { mediaUrl } from '../../api/client'
import ProfileBanner from '../ui/ProfileBanner'
import toast from 'react-hot-toast'
import ProfileCosmetics from './ProfileCosmetics'
import ProfileIdentity from './ProfileIdentity'
import { useT } from '../../i18n'
import { AvatarDecoration } from '../ui/ProfileDecor'
import AvatarRing from '../ui/AvatarRing'
import { useNameStyles } from '../../store/nameStyles'
import { setUnsaved, useDraft, type DraftReport, type Patch } from './profileDraft'
import ImageCropDialog from './ImageCropDialog'

interface Props {
  user: any
  updateMe: (d: any) => void
}

const IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp'
const apiError = (e: any, fallback: string): string => e?.response?.data?.error ?? fallback

/** Bio et pronoms : brouillon remonté à ProfileSection (enregistrement unique). */
function AboutFields({ user, report }: { user: any; report: DraftReport }) {
  const t = useT()
  const [bio, setBio] = useState<string>(user.bio ?? '')
  const [pronouns, setPronouns] = useState<string>(user.pronouns ?? '')
  useDraft('about', { bio, pronouns }, report)
  return (
    <>
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
    </>
  )
}

/**
 * Profil du compte. Images (avatar, bannière) : envoyées tout de suite. Le reste (à propos,
 * identité, cosmétiques) : un seul brouillon, une seule barre « modifications non
 * enregistrées » (réinitialiser / enregistrer), un seul PATCH /users/me ; quitter avec des
 * modifications en attente demande confirmation (profileDraft.ts, SettingsPage).
 */
export default function ProfileSection({ user, updateMe }: Props) {
  const t = useT()
  const [bannerPreview, setBannerPreview] = useState<string | null>(user.banner ?? null)
  const fileRef = React.useRef<HTMLInputElement>(null)
  const bannerRef = React.useRef<HTMLInputElement>(null)
  const [cropFile, setCropFile] = useState<File | null>(null)
  // `gen` remonte les parties du formulaire : réinitialiser, ou repartir du profil enregistré.
  const [gen, setGen] = useState(0)
  const [drafts, setDrafts] = useState<Record<string, { patch: Patch; invalid: boolean }>>({})
  const report = useCallback<DraftReport>((id, patch, invalid = false) => setDrafts(d => {
    if (patch) return { ...d, [id]: { patch, invalid } }
    if (!(id in d)) return d
    const rest = { ...d }
    delete rest[id]
    return rest
  }), [])
  const dirty = Object.keys(drafts).length > 0
  const invalid = Object.values(drafts).some(d => d.invalid)
  useEffect(() => { setUnsaved(dirty) }, [dirty])
  useEffect(() => () => setUnsaved(false), [])

  const reset = () => { setDrafts({}); setGen(g => g + 1) }

  const save = useMutation({
    mutationFn: () => api.patch('/users/me', Object.assign({}, ...Object.values(drafts).map(d => d.patch))),
    onSuccess: r => {
      updateMe(r.data)
      // Pseudo stylé partout tout de suite (sans attendre le USER_UPDATE).
      useNameStyles.getState().set(user.id, r.data)
      reset()
      toast.success(t('psave.saved'))
    },
    onError: (e: any) => toast.error(apiError(e, t('common.error'))),
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

  // "" = retirer (le serveur ignore `null`), comme pour la bannière.
  const removeAvatar = useMutation({
    mutationFn: () => api.patch('/users/me', { avatar: '' }),
    onSuccess: r => {
      updateMe(r.data)
      if (r.data?.avatar) toast.error(t('common.error'))
      else toast.success(t('psave.avatarRemoved'))
    },
    onError: (e: any) => toast.error(apiError(e, t('common.error'))),
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

  // Aperçu de l'avatar avec l'anneau et la décoration en cours d'édition (brouillon sinon profil).
  const cos = drafts.cosmetics?.patch
  const look = cos ?? user

  return (
    <div className="space-y-6">
      {/* Bannière */}
      <div>
        <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">{t('settings.profile.banner')}</label>
        <div
          role="button"
          tabIndex={0}
          aria-label={t('psave.changeBanner')}
          onClick={() => bannerRef.current?.click()}
          onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); bannerRef.current?.click() } }}
          className="relative rounded-lg overflow-hidden cursor-pointer group border border-fc-hover hover:border-fc-accent focus-visible:border-fc-accent transition"
        >
          {/* Aperçu : la bannière entière, telle que les autres la verront (jamais rognée). */}
          <ProfileBanner src={bannerPreview} minHeight={72} maxHeight={220} emptyClassName="h-24 bg-fc-channel flex items-center justify-center">
            {!bannerPreview && (
              <div className="text-center">
                <Camera size={20} className="text-fc-muted mx-auto mb-1" />
                <p className="text-xs text-fc-muted">{t('settings.profile.addBanner')}</p>
              </div>
            )}
          </ProfileBanner>
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition flex items-center justify-center">
            <Camera size={20} className="text-white opacity-0 group-hover:opacity-100 transition" />
          </div>
          {bannerPreview && (
            <button
              type="button"
              // `null` est ignoré par le serveur (colonne gardée) ; une chaîne vide efface la bannière.
              onClick={e => {
                e.stopPropagation()
                api.patch('/users/me', { banner: '' })
                  .then(() => { setBannerPreview(null); updateMe({ ...user, banner: null }) })
                  .catch((err: any) => toast.error(apiError(err, t('common.error'))))
              }}
              aria-label={t('settings.profile.removeBanner')}
              className="absolute top-1.5 right-1.5 p-1 bg-black/60 rounded-full text-white opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 transition hover:bg-red-600"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
        <input
          ref={bannerRef}
          type="file"
          accept={IMAGE_TYPES}
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0]
            // Réinitialisé : choisir de nouveau le même fichier redéclenche l'envoi.
            e.target.value = ''
            if (file) uploadBanner.mutate(file)
          }}
        />
        <p className="text-xs text-fc-muted mt-1">{t('settings.profile.bannerFormats')}</p>
      </div>

      {/* Avatar */}
      <div className="flex items-center gap-4">
        <div className="relative">
          <AvatarDecoration id={look.avatar_decoration as string | null | undefined} opts={look.avatar_decoration_opts} size={80}>
            <AvatarRing ring={look.avatar_ring} size={88}>
              <div className="w-20 h-20 rounded-full bg-fc-accent flex items-center justify-center text-3xl font-bold text-white overflow-hidden">
                {user.avatar
                  ? <img src={mediaUrl(user.avatar)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                  : user.username.charAt(0).toUpperCase()}
              </div>
            </AvatarRing>
          </AvatarDecoration>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            aria-label={t('settings.profile.changeAvatar')}
            className="absolute -bottom-1 -right-1 p-1.5 bg-fc-accent rounded-full text-white hover:bg-fc-accent/80 transition"
          >
            <Camera size={12} />
          </button>
          {user.avatar && (
            <button
              type="button"
              onClick={() => removeAvatar.mutate()}
              disabled={removeAvatar.isPending}
              aria-label={t('psave.removeAvatar')}
              title={t('psave.removeAvatar')}
              className="absolute -top-1 -right-1 p-1.5 bg-black/70 rounded-full text-white hover:bg-red-600 transition disabled:opacity-50"
            >
              <Trash2 size={12} />
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept={`${IMAGE_TYPES},image/apng`}
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) setCropFile(file)
            }}
          />
        </div>
        <div>
          <p className="text-sm font-medium text-white">{user.username}</p>
          <p className="text-xs text-fc-muted">{t('settings.profile.avatarHint')}</p>
        </div>
      </div>

      <AboutFields key={`about-${gen}`} user={user} report={report} />

      <BirthdaySettings />

      <ProfileIdentity key={`id-${gen}`} user={user} report={report} />

      <ProfileCosmetics key={`cos-${gen}`} user={user} report={report}
        previewName={(drafts.identity?.patch.display_name as string | undefined) || user.display_name || user.username} />

      {/* Barre unique des modifications en attente (collée en bas de la zone de défilement). */}
      {dirty && (
        <div role="region" aria-label={t('psave.bar')} className="sticky bottom-4 z-20 flex flex-wrap items-center gap-3 rounded-xl border border-fc-hover bg-fc-channel/95 backdrop-blur px-4 py-3 shadow-2xl">
          <p className="flex-1 min-w-[12rem] text-sm text-white" aria-live="polite">{invalid ? t('psave.invalid') : t('psave.bar')}</p>
          <button type="button" onClick={reset} disabled={save.isPending} className="px-3 py-1.5 text-sm text-fc-muted hover:text-white underline disabled:opacity-50">
            {t('psave.reset')}
          </button>
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending || invalid}
            className="px-4 py-1.5 bg-fc-accent hover:bg-fc-accent/80 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition"
          >
            {save.isPending ? t('common.saving') : t('psave.save')}
          </button>
        </div>
      )}
      {cropFile && (
        <ImageCropDialog file={cropFile} onCancel={() => setCropFile(null)}
          onDone={f => { setCropFile(null); uploadAvatar.mutate(f) }} />
      )}
    </div>
  )
}
