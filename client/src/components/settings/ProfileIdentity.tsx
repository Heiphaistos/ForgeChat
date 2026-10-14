import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Field } from './shared'
import { useT } from '../../i18n'
import { cleanStyle, type NameStyle, type TagStyle } from '../../lib/nameStyle'
import NameStyleFields, { EMPTY_STYLE } from './NameStyleFields'
import TagStyleFields from './TagStyleFields'
import StyledNameText from '../ui/StyledNameText'
import ClanTag from '../ui/ClanTag'
import type { ProfileLink } from '../ui/ProfileLinks'
import { useDraft, type DraftReport } from './profileDraft'

interface Props {
  user: any
  /** Brouillon remonté à ProfileSection (enregistrement unique, profileDraft.ts). */
  report: DraftReport
}

const MAX_LINKS = 5
const isHttps = (u: string) => /^https:\/\/[^\s/?#]+\.[^\s]+$/i.test(u.trim())

/**
 * Identité du profil (gratuite) : nom d'affichage, style du pseudo (couleur unie ou
 * dégradé, effet, police, contour : components/settings/NameStyleFields.tsx), étiquette
 * perso et son style de marque (TagStyleFields.tsx) et liens. Le serveur revalide tout
 * (server/src/models/profile_style.rs).
 */
export default function ProfileIdentity({ user, report }: Props) {
  const t = useT()
  const [displayName, setDisplayName] = useState<string>(user.display_name ?? '')
  const [style, setStyle] = useState<NameStyle>(cleanStyle(user.name_style) ?? EMPTY_STYLE)
  const [tag, setTag] = useState<string>(user.profile_tag ?? '')
  const [links, setLinks] = useState<ProfileLink[]>(Array.isArray(user.profile_links) ? user.profile_links : [])

  const badLink = links.some(l => !l.label.trim() || !isHttps(l.url))

  useDraft('identity', {
    display_name: displayName.trim(),
    // {} = style par défaut ; [] = aucun lien ; "" = retirer.
    name_style: cleanStyle(style) ?? {},
    profile_tag: tag.trim(),
    profile_links: links.map(l => ({ label: l.label.trim(), url: l.url.trim() })),
  }, report, badLink)

  const tagStyle: TagStyle = style.tag ?? {}
  const tagRest: Omit<TagStyle, 'color'> = { color2: tagStyle.color2, font: tagStyle.font, badge: tagStyle.badge, icon: tagStyle.icon }
  return (
    <div className="space-y-5 border-t border-fc-hover pt-6">
      <h3 className="text-sm font-semibold text-white">{t('profileId.title')} <span className="text-xs font-normal text-fc-muted">{t('settings.cosmetics.free')}</span></h3>

      <div className="rounded-xl border border-fc-hover bg-fc-bg px-4 py-3" aria-live="polite">
        <p className="text-xs text-fc-muted mb-1">{t('profileId.preview')}</p>
        <StyledNameText text={displayName.trim() || user.username} style={style} className="text-lg font-semibold text-white" />
        {tag.trim() && <ClanTag name={tag.trim()} style={style.tag} fallback="soft" className="ml-1.5" />}
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

      <NameStyleFields value={style} onChange={setStyle} sample={displayName.trim() || user.username} />

      <Field label={t('profileId.tag')} hint={t('profileId.tagHint')}>
        <input value={tag} onChange={e => setTag(e.target.value)} maxLength={16} autoComplete="off" className="w-full fc-input text-sm" placeholder={t('profileId.tagPlaceholder')} />
      </Field>
      {tag.trim() && (
        <Field label={t('pedit.tag.style')} hint={t('pedit.tag.styleHint')}>
          <TagStyleFields
            name={tag.trim()}
            color={tagStyle.color ?? null}
            onColor={c => setStyle(s => ({ ...s, tag: { ...tagStyle, color: c ?? undefined } }))}
            colorOptional
            value={tagRest}
            onChange={next => setStyle(s => ({ ...s, tag: { ...next, color: tagStyle.color } }))}
            fallback="soft"
          />
        </Field>
      )}

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
    </div>
  )
}
