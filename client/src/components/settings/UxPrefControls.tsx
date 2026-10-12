// Réglages propres à l'appareil (lib/uxPrefs.ts) : contrôles liés au store et groupes
// affichés dans Affichage du texte, Accessibilité et Mode streamer. Appliqués tout de suite.
import type { ReactNode } from 'react'
import { useT, type Key } from '../../i18n'
import { useUxPrefs, type UxPrefs } from '../../lib/uxPrefs'
import { Select, Toggle } from './shared'

type BoolKey = { [K in keyof UxPrefs]: UxPrefs[K] extends boolean ? K : never }[keyof UxPrefs]
type NumKey = { [K in keyof UxPrefs]: UxPrefs[K] extends number ? K : never }[keyof UxPrefs]

export function PrefToggle({ k, label, desc }: { k: BoolKey; label: Key; desc?: Key }) {
  const t = useT()
  const value = useUxPrefs(s => s[k])
  const set = useUxPrefs(s => s.set)
  return (
    <div className="flex items-center justify-between gap-3 p-4 bg-fc-channel rounded-xl border border-fc-hover">
      <div>
        <div className="text-sm font-medium text-white">{t(label)}</div>
        {desc && <div className="text-xs text-fc-muted">{t(desc)}</div>}
      </div>
      <Toggle value={value} onChange={v => set({ [k]: v } as Partial<UxPrefs>)} label={t(label)} />
    </div>
  )
}

export function PrefSlider({ k, label, min, max, step = 5 }: { k: NumKey; label: Key; min: number; max: number; step?: number }) {
  const t = useT()
  const value = useUxPrefs(s => s[k])
  const set = useUxPrefs(s => s.set)
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm text-fc-text">
        <span>{t(label)}</span>
        <button type="button" onClick={() => set({ [k]: 100 } as Partial<UxPrefs>)} className="text-xs text-fc-muted hover:text-white" title={t('ux.reset')}>{value} %</button>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={t(label)}
        onChange={e => set({ [k]: Number(e.target.value) } as Partial<UxPrefs>)} className="w-full accent-fc-accent" />
    </div>
  )
}

const H = ({ children }: { children: ReactNode }) => (
  <h3 className="text-xs font-semibold text-fc-muted uppercase tracking-wide pt-2">{children}</h3>
)

/** Affichage des messages : spoilers, réactions, pièces jointes, émoticônes. */
export function MessageDisplayPrefs() {
  const t = useT()
  const spoilers = useUxPrefs(s => s.spoilers)
  const set = useUxPrefs(s => s.set)
  return (
    <div className="space-y-3">
      <H>{t('ux.display.title')}</H>
      <div className="space-y-1.5">
        <label className="text-sm text-fc-text">{t('ux.display.spoilers')}</label>
        <Select value={spoilers} onChange={v => set({ spoilers: v as UxPrefs['spoilers'] })} className="w-full"
          options={[
            { value: 'click', label: t('ux.display.spoilers.click') },
            { value: 'moderated', label: t('ux.display.spoilers.moderated') },
            { value: 'always', label: t('ux.display.spoilers.always') },
          ]} />
      </div>
      <PrefToggle k="showReactions" label="ux.display.reactions" />
      <PrefToggle k="showAttachments" label="ux.display.attachments" desc="ux.display.attachmentsDesc" />
      <PrefToggle k="convertEmoticons" label="ux.display.emoticons" desc="ux.display.emoticonsDesc" />
    </div>
  )
}

/** Zone de saisie : suggestions, aperçu du markdown, touche d'envoi, correcteur. */
export function ComposerPrefs() {
  const t = useT()
  const sendKey = useUxPrefs(s => s.sendKey)
  const set = useUxPrefs(s => s.set)
  return (
    <div className="space-y-3">
      <H>{t('ux.composer.title')}</H>
      <PrefToggle k="emojiSuggest" label="ux.composer.emoji" desc="ux.composer.emojiDesc" />
      <PrefToggle k="mentionSuggest" label="ux.composer.mentions" desc="ux.composer.mentionsDesc" />
      <PrefToggle k="markdownPreview" label="ux.composer.preview" desc="ux.composer.previewDesc" />
      <PrefToggle k="spellcheck" label="ux.composer.spellcheck" />
      <div className="space-y-1.5">
        <label className="text-sm text-fc-text">{t('ux.composer.sendKey')}</label>
        <Select value={sendKey} onChange={v => set({ sendKey: v as UxPrefs['sendKey'] })} className="w-full"
          options={[
            { value: 'enter', label: t('ux.composer.sendEnter') },
            { value: 'ctrlEnter', label: t('ux.composer.sendCtrlEnter') },
          ]} />
      </div>
    </div>
  )
}

/** Accessibilité propre à l'appareil : couleurs, contraste, zoom, lisibilité, liens, rôles. */
export function AccessibilityPrefs() {
  const t = useT()
  return (
    <div className="space-y-3">
      <H>{t('ux.access.title')}</H>
      <PrefSlider k="saturation" label="ux.access.saturation" min={0} max={150} />
      <PrefSlider k="contrast" label="ux.access.contrast" min={80} max={150} />
      <PrefSlider k="zoom" label="ux.access.zoom" min={75} max={150} />
      <PrefToggle k="readableText" label="ux.access.readable" desc="ux.access.readableDesc" />
      <PrefToggle k="underlineLinks" label="ux.access.underline" />
      <PrefToggle k="roleIcons" label="ux.access.roleIcons" desc="ux.access.roleIconsDesc" />
    </div>
  )
}

/** Options du mode streamer. */
export function StreamerPrefs() {
  const t = useT()
  return (
    <div className="space-y-3">
      <H>{t('ux.streamer.options')}</H>
      <PrefToggle k="smPersonal" label="ux.streamer.personal" desc="ux.streamer.personalDesc" />
      <PrefToggle k="smInvites" label="ux.streamer.invites" />
      <PrefToggle k="smIds" label="ux.streamer.ids" />
      <PrefToggle k="smSounds" label="ux.streamer.sounds" />
      <PrefToggle k="smNotifications" label="ux.streamer.notifications" />
      <PrefToggle k="smDmPreviews" label="ux.streamer.previews" desc="ux.streamer.previewsDesc" />
      <PrefToggle k="smAuto" label="ux.streamer.auto" desc="ux.streamer.autoDesc" />
    </div>
  )
}
