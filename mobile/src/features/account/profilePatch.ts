import type { UpdateProfile } from '@/api/users'
import { cleanRing, type AvatarRingData } from '@/components/avatarRingCore'
import type { Cosmetics } from '@/features/account/ProfileCosmeticsEditor'
import { cardPayload, cleanCard, type ProfileCard } from '@/features/account/profileCard'
import { cleanDecoOpts, cleanIntensity, decoOptsPayload } from '@/features/account/profileDecor'
import { cleanNameStyle, type NameStyle } from '@/lib/nameStyle'
import type { ProfileLink, User } from '@/types/models'

/** Valeur envoyée seulement si elle diffère de celle du compte (absent = inchangé côté serveur). */
const changed = <T>(next: T, prev: unknown): T | undefined => (JSON.stringify(next) === JSON.stringify(prev) ? undefined : next)
const linksBody = (ls: readonly ProfileLink[]) => ls.map((l) => ({ label: l.label.trim(), url: l.url.trim() }))

export interface ProfileForm {
  username: string
  bio: string
  customStatus: string
  /** null = échéance du statut inchangée. */
  clearAfter: number | null
  displayName: string
  tag: string
  nameStyle: NameStyle
  links: ProfileLink[]
  pronouns: string
  cosmetics: Cosmetics
  ring: AvatarRingData | null
  card: ProfileCard
}

/**
 * Corps du PATCH /users/me : uniquement les champs modifiés par rapport au compte (`user`),
 * pour ne jamais écraser avec une valeur vide ou périmée ce qui a changé ailleurs (web, autre appareil).
 */
export function profilePatch(user: User, f: ProfileForm): UpdateProfile {
  // Renvoyer le statut remet son échéance à zéro : seulement s'il change ou si une durée est choisie.
  const sendStatus = f.customStatus.trim() !== (user.custom_status ?? '') || f.clearAfter != null
  const c = f.cosmetics
  return {
    username: changed(f.username.trim(), user.username),
    bio: changed(f.bio.trim(), user.bio ?? ''),
    custom_status: sendStatus ? f.customStatus.trim() : undefined,
    custom_status_clear_after: sendStatus ? (f.clearAfter ?? 0) : undefined,
    display_name: changed(f.displayName.trim(), user.display_name ?? ''),
    profile_tag: changed(f.tag.trim(), user.profile_tag ?? ''),
    name_style: changed(cleanNameStyle(f.nameStyle) ?? {}, cleanNameStyle(user.name_style) ?? {}),
    profile_links: changed(linksBody(f.links), linksBody(user.profile_links ?? [])),
    pronouns: changed(f.pronouns.trim(), user.pronouns ?? ''),
    // "" et -1 = retirer.
    avatar_decoration: changed(c.decoration, user.avatar_decoration ?? ''),
    avatar_decoration_opts: changed(decoOptsPayload(c.opts), decoOptsPayload(cleanDecoOpts(user.avatar_decoration_opts))),
    profile_effect_intensity: changed(c.intensity, cleanIntensity(user.profile_effect_intensity)),
    profile_color_primary: changed(c.primary ?? -1, user.profile_color_primary ?? -1),
    profile_color_accent: changed(c.accent ?? -1, user.profile_color_accent ?? -1),
    profile_effect: changed(c.effect, user.profile_effect ?? ''),
    avatar_ring: changed(cleanRing(f.ring), cleanRing(user.avatar_ring)),
    profile_card: changed(cardPayload(f.card), cardPayload(cleanCard(user.profile_card))),
  }
}

/** État initial du formulaire tiré du compte (même normalisation que profilePatch). */
export function profileForm(user: User): ProfileForm {
  return {
    username: user.username,
    bio: user.bio ?? '',
    customStatus: user.custom_status ?? '',
    clearAfter: null,
    displayName: user.display_name ?? '',
    tag: user.profile_tag ?? '',
    nameStyle: cleanNameStyle(user.name_style) ?? { colors: [] },
    links: user.profile_links ?? [],
    pronouns: user.pronouns ?? '',
    cosmetics: {
      decoration: user.avatar_decoration ?? '',
      opts: cleanDecoOpts(user.avatar_decoration_opts),
      primary: user.profile_color_primary ?? null,
      accent: user.profile_color_accent ?? null,
      effect: user.profile_effect ?? '',
      intensity: cleanIntensity(user.profile_effect_intensity),
    },
    ring: cleanRing(user.avatar_ring),
    card: cleanCard(user.profile_card),
  }
}
