import { useState, type CSSProperties } from 'react'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Plus, Trash2 } from 'lucide-react'
import api from '../../api/client'
import { Field, Select } from './shared'
import { useT } from '../../i18n'
import { NAME_EFFECTS, NAME_FONTS, cleanStyle, hex, nameCss, type NameStyle } from '../../lib/nameStyle'
import type { ProfileLink } from '../ui/ProfileLinks'

interface Props {
  user: any
  updateMe: (d: any) => void
}

/** Préréglages (une couleur = unie, plusieurs = dégradé). */
const PRESETS: number[][] = [
  [0xff5c8a], [0xffd166], [0x5ee7df], [0x7dffb0], [0xb388ff], [0xff9f43],
  [0x00c6ff, 0x7b2ff7], [0xff7e5f, 0xfeb47b], [0xff00e5, 0x00f0ff],
  [0xff3d00, 0xffb300], [0x2ecc71, 0x5ee7df], [0xff3b30, 0xffcc00, 0x007aff],
]
const MAX_LINKS = 5
const isHttps = (u: string) => /^https:\/\/[^\s/?#]+\.[^\s]+$/i.test(u.trim())

/**
 * Identité du profil (gratuite) : nom d'affichage, style du pseudo (couleur unie ou
 * dégradé, effet, police), étiquette perso et liens. Le serveur revalide tout
 * (server/src/models/profile_style.rs).
 */
export default function ProfileIdentity({ user, updateMe }: Props) {
  const t = useT()
  const [displayName, setDisplayName] = useState<string>(user.display_name ?? '')
  const [style, setStyle] = useState<NameStyle>(cleanStyle(user.name_style) ?? { colors: [], angle: 90, effect: '', font: '' })
  const [tag, setTag] = useState<string>(user.profile_tag ?? '')
  const [links, setLinks] = useState<ProfileLink[]>(Array.isArray(user.profile_links) ? user.profile_links : [])

  const colors = style.colors ?? []
  const patch = (p: Partial<NameStyle>) => setStyle(s => ({ ...s, ...p }))
  const setColor = (i: number, c: number) => patch({ colors: colors.map((v, j) => (j === i ? c : v)) })
  const badLink = links.some(l => !l.label.trim() || !isHttps(l.url))

  const save = useMutation({
    mutationFn: () => api.patch('/users/me', {
      display_name: displayName.trim(),
      // {} = style par défaut ; [] = aucun lien ; "" = retirer.
      name_style: cleanStyle(style) ?? {},
      profile_tag: tag.trim(),
      profile_links: links.map(l => ({ label: l.label.trim(), url: l.url.trim() })),
    }),
    onSuccess: r => { updateMe(r.data); toast.success(t('profileId.saved')) },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('common.error')),
  })

  const preview = cleanStyle(style)
  return (
    <div className="space-y-5 border-t border-fc-hover pt-6">
      <h3 className="text-sm font-semibold text-white">{t('profileId.title')} <span className="text-xs font-normal text-fc-muted">{t('settings.cosmetics.free')}</span></h3>

      <div className="rounded-xl border border-fc-hover bg-fc-bg px-4 py-3" aria-live="polite">
        <p className="text-xs text-fc-muted mb-1">{t('profileId.preview')}</p>
        <span className={`text-lg font-semibold text-white ${preview?.effect === 'shimmer' ? 'fc-name-shimmer' : ''}`} style={nameCss(preview) as CSSProperties}>
          {displayName.trim() || user.username}
        </span>
        {tag.trim() && <span className="ml-1.5 px-1 rounded text-[10px] font-semibold bg-fc-hover text-fc-muted align-middle">{tag.trim()}</span>}
        <p className="text-xs text-fc-muted">{user.username}<span className="streamer-blur">#{user.discriminator}</span></p>
      </div>

      <Field label={t('profileId.displayName')} hint={t('profileId.displayNameHint')}>
        <input
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          maxLength={32}
          placeholder={user.username}
          autoComplete="off"
          className="w-full fc-input text-sm"
        />
      </Field>

      <Field label={t('profileId.color')} hint={t('profileId.colorHint')}>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => patch({ colors: [] })} aria-pressed={!colors.length}
              className={`h-7 px-2 rounded-full text-xs border ${!colors.length ? 'border-fc-accent text-white' : 'border-fc-hover text-fc-muted'}`}>
              {t('profileId.defaultColor')}
            </button>
            {PRESETS.map((p, i) => (
              <button
                key={i}
                type="button"
                onClick={() => patch({ colors: p })}
                aria-label={t('profileId.preset', { n: i + 1 })}
                aria-pressed={colors.join() === p.join()}
                className={`w-7 h-7 rounded-full border-2 ${colors.join() === p.join() ? 'border-white' : 'border-transparent'}`}
                style={{ background: p.length > 1 ? `linear-gradient(135deg, ${p.map(hex).join(', ')})` : hex(p[0]) }}
              />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {colors.map((c, i) => (
              <label key={i} className="flex items-center gap-1.5 text-xs text-fc-muted">
                <input type="color" value={hex(c)} onChange={e => setColor(i, parseInt(e.target.value.slice(1), 16))} className="w-8 h-8 rounded cursor-pointer bg-transparent" aria-label={t('profileId.colorN', { n: i + 1 })} />
                {colors.length > 1 && (
                  <button type="button" onClick={() => patch({ colors: colors.filter((_, j) => j !== i) })} aria-label={t('profileId.removeColor')} className="text-fc-muted hover:text-white">
                    <Trash2 size={12} />
                  </button>
                )}
              </label>
            ))}
            {colors.length < 3 && (
              <button type="button" onClick={() => patch({ colors: [...colors, colors[colors.length - 1] ?? 0x5865f2] })} className="flex items-center gap-1 text-xs text-fc-muted hover:text-white">
                <Plus size={12} /> {colors.length ? t('profileId.addColor') : t('profileId.pickColor')}
              </button>
            )}
          </div>
          {colors.length > 1 && (
            <label className="flex items-center gap-3 text-xs text-fc-muted">
              {t('profileId.angle', { n: style.angle ?? 90 })}
              <input type="range" min={0} max={360} step={15} value={style.angle ?? 90} onChange={e => patch({ angle: Number(e.target.value) })} className="flex-1 accent-fc-accent" />
            </label>
          )}
        </div>
      </Field>

      <div className="grid sm:grid-cols-2 gap-4">
        <Field label={t('profileId.effect')} hint={t('profileId.effectHint')}>
          <Select value={style.effect ?? ''} onChange={v => patch({ effect: v as NameStyle['effect'] })} className="w-full"
            options={NAME_EFFECTS.map(e => ({ value: e, label: t(`profileId.effect.${e || 'none'}` as 'profileId.effect.none') }))} />
        </Field>
        <Field label={t('profileId.font')}>
          <Select value={style.font ?? ''} onChange={v => patch({ font: v as NameStyle['font'] })} className="w-full"
            options={NAME_FONTS.map(f => ({ value: f, label: t(`profileId.font.${f || 'default'}` as 'profileId.font.default') }))} />
        </Field>
      </div>

      <Field label={t('profileId.tag')} hint={t('profileId.tagHint')}>
        <input value={tag} onChange={e => setTag(e.target.value)} maxLength={16} autoComplete="off" className="w-full fc-input text-sm" placeholder={t('profileId.tagPlaceholder')} />
      </Field>

      <Field label={t('profileId.links')} hint={t('profileId.linksHint')}>
        <div className="space-y-2">
          {links.map((l, i) => (
            <div key={i} className="flex gap-2">
              <input value={l.label} onChange={e => setLinks(ls => ls.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                maxLength={32} placeholder={t('profileId.linkLabel')} className="w-1/3 fc-input text-sm" aria-label={t('profileId.linkLabel')} />
              <input value={l.url} onChange={e => setLinks(ls => ls.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                maxLength={256} placeholder="https://" inputMode="url" autoCapitalize="none"
                className={`flex-1 fc-input text-sm ${l.url && !isHttps(l.url) ? 'border-fc-red' : ''}`} aria-label={t('profileId.linkUrl')} aria-invalid={!!l.url && !isHttps(l.url)} />
              <button type="button" onClick={() => setLinks(ls => ls.filter((_, j) => j !== i))} aria-label={t('profileId.removeLink')} className="p-2 text-fc-muted hover:text-fc-red">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {links.length < MAX_LINKS && (
            <button type="button" onClick={() => setLinks(ls => [...ls, { label: '', url: '' }])} className="flex items-center gap-1 text-xs text-fc-muted hover:text-white">
              <Plus size={12} /> {t('profileId.addLink')}
            </button>
          )}
          {badLink && <p className="text-xs text-fc-red">{t('profileId.linkInvalid')}</p>}
        </div>
      </Field>

      <button
        onClick={() => save.mutate()}
        disabled={save.isPending || badLink}
        className="px-5 py-2 bg-fc-accent hover:bg-fc-accent/80 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition"
      >
        {save.isPending ? t('common.saving') : t('profileId.save')}
      </button>
    </div>
  )
}
