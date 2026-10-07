import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api, { mediaUrl } from '../../api/client'
import { Field, Select } from './shared'
import { useT } from '../../i18n'
import { AvatarDecoration, DECORATIONS, PROFILE_EFFECTS, ProfileEffect, hexColor, profileThemeBackground } from '../ui/ProfileDecor'

interface Props {
  user: any
  updateMe: (d: any) => void
}

const toInt = (hex: string) => parseInt(hex.slice(1), 16)

/** Décoration d'avatar, thème et effet de la fiche profil — gratuits, avec aperçu. */
export default function ProfileCosmetics({ user, updateMe }: Props) {
  const t = useT()
  const [decoration, setDecoration] = useState<string>(user.avatar_decoration ?? '')
  const [primary, setPrimary] = useState<number | null>(user.profile_color_primary ?? null)
  const [accent, setAccent] = useState<number | null>(user.profile_color_accent ?? null)
  const [effect, setEffect] = useState<string>(user.profile_effect ?? '')
  const [replay, setReplay] = useState(0)

  const save = useMutation({
    // "" et -1 = retirer (le serveur ignore les champs absents).
    mutationFn: () => api.patch('/users/me', {
      avatar_decoration: decoration,
      profile_color_primary: primary ?? -1,
      profile_color_accent: accent ?? -1,
      profile_effect: effect,
    }),
    onSuccess: r => { updateMe(r.data); toast.success(t('settings.cosmetics.saved')) },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('common.error')),
  })

  const avatar = (size: number) => (
    <div className="rounded-full bg-fc-accent flex items-center justify-center font-bold text-white overflow-hidden" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {user.avatar
        ? <img src={mediaUrl(user.avatar)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
        : user.username.charAt(0).toUpperCase()}
    </div>
  )

  return (
    <div className="space-y-5 border-t border-fc-hover pt-6">
      <h3 className="text-sm font-semibold text-white">{t('settings.cosmetics.title')} <span className="text-xs font-normal text-fc-muted">{t('settings.cosmetics.free')}</span></h3>

      {/* Aperçu de la fiche */}
      <div
        key={replay}
        className="relative rounded-xl overflow-hidden border border-fc-hover p-5 flex items-center gap-4 bg-fc-bg"
        style={{ background: profileThemeBackground(primary, accent) }}
      >
        <ProfileEffect key={effect} id={effect} />
        <AvatarDecoration id={decoration} size={64}>{avatar(64)}</AvatarDecoration>
        <div className="min-w-0">
          <p className="text-white font-semibold truncate">{user.username}</p>
          <p className="text-xs text-fc-muted">{t('settings.cosmetics.preview')}</p>
        </div>
      </div>

      <Field label={t('settings.cosmetics.decoration')}>
        <div className="grid grid-cols-4 sm:grid-cols-5 gap-3">
          {[{ id: '', label: t('settings.cosmetics.noneF') }, ...DECORATIONS.map(d => ({ id: d.id, label: t(d.label) }))].map(d => (
            <button
              key={d.id || 'none'}
              type="button"
              onClick={() => setDecoration(d.id)}
              aria-pressed={decoration === d.id}
              title={d.label}
              className={`flex flex-col items-center gap-1.5 p-2 rounded-lg border transition ${decoration === d.id ? 'border-fc-accent bg-fc-accent/10' : 'border-fc-hover hover:border-fc-muted'}`}
            >
              <AvatarDecoration id={d.id} size={36}>{avatar(36)}</AvatarDecoration>
              <span className="text-[10px] text-fc-muted truncate max-w-full">{d.label}</span>
            </button>
          ))}
        </div>
      </Field>

      <Field label={t('settings.cosmetics.theme')} hint={t('settings.cosmetics.themeHint')}>
        <div className="flex flex-wrap items-center gap-4">
          {([[t('settings.cosmetics.primary'), primary, setPrimary], [t('settings.cosmetics.accent'), accent, setAccent]] as const).map(([label, value, set]) => (
            <label key={label} className="flex items-center gap-2 text-sm text-fc-text">
              <input
                type="color"
                value={hexColor(value ?? 0x5865f2)}
                onChange={e => set(toInt(e.target.value))}
                className="w-9 h-9 rounded cursor-pointer bg-transparent"
              />
              {label}
            </label>
          ))}
          {(primary != null || accent != null) && (
            <button type="button" onClick={() => { setPrimary(null); setAccent(null) }} className="text-xs text-fc-muted hover:text-white underline">
              {t('settings.cosmetics.defaultTheme')}
            </button>
          )}
        </div>
      </Field>

      <Field label={t('settings.cosmetics.effect')} hint={t('settings.cosmetics.effectHint')}>
        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={effect}
            onChange={setEffect}
            options={[{ value: '', label: t('settings.access.none') }, ...PROFILE_EFFECTS.map(e => ({ value: e.id, label: t(e.label) }))]}
          />
          {effect && (
            <button type="button" onClick={() => setReplay(n => n + 1)} className="text-xs text-fc-muted hover:text-white underline">
              {t('settings.cosmetics.replay')}
            </button>
          )}
        </div>
      </Field>

      <button
        onClick={() => save.mutate()}
        disabled={save.isPending}
        className="px-5 py-2 bg-fc-accent hover:bg-fc-accent/80 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition"
      >
        {save.isPending ? t('common.saving') : t('settings.cosmetics.save')}
      </button>
    </div>
  )
}
