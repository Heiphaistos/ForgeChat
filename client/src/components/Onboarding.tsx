import { useState } from 'react'
import { useT, type Key } from '../i18n'

interface Props {
  onDone: () => void
}

// Étapes : emoji + clés intro.sN.title / intro.sN.desc (i18n/parts/auditChat.ts).
// Étape 2 = amélioration n° 40 (2026-10-12) : le chiffrement expliqué dès l'arrivée.
const STEPS = ['💬', '🔒', '🛡️', '🔑', '🌐', '🔔', '🚀'].map((emoji, i) => ({
  emoji,
  title: `intro.s${i + 1}.title` as Key,
  description: `intro.s${i + 1}.desc` as Key,
}))

export default function Onboarding({ onDone }: Props) {
  const tr = useT()
  const [step, setStep] = useState(0)

  const finish = () => {
    localStorage.setItem('fc_onboarding_done', 'true')
    onDone()
  }

  const next = () => {
    if (step < STEPS.length - 1) {
      setStep(s => s + 1)
    } else {
      finish()
    }
  }

  const current = STEPS[step]

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        className="bg-fc-sidebar rounded-2xl p-8 max-w-md w-full shadow-2xl flex flex-col gap-6 mx-3"
      >
        {/* Progress dots */}
        <div
          role="progressbar"
          aria-valuenow={step + 1}
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-label={tr('intro.step', { n: step + 1, total: STEPS.length })}
          className="flex justify-center gap-2"
        >
          {STEPS.map((_, i) => (
            <div
              key={i}
              aria-hidden
              className={`w-2.5 h-2.5 rounded-full transition-colors ${
                i <= step ? 'bg-fc-accent' : 'bg-fc-hover'
              }`}
            />
          ))}
        </div>

        {/* Step content — aria-live so screen readers announce step changes */}
        <div aria-live="polite" aria-atomic="true" className="flex flex-col items-center text-center gap-3">
          <span aria-hidden className="text-5xl">{current.emoji}</span>
          <h2 id="onboarding-title" className="text-xl font-bold text-white">{tr(current.title)}</h2>
          <p className="text-fc-muted text-sm leading-relaxed">{tr(current.description)}</p>
        </div>

        <div className="flex flex-col items-center gap-3">
          <button
            onClick={next}
            className="w-full bg-fc-accent hover:bg-fc-accent/80 text-white font-semibold py-2.5 rounded-xl transition"
          >
            {tr(step < STEPS.length - 1 ? 'intro.next' : 'intro.start')}
          </button>
          <button
            onClick={finish}
            aria-label={tr('intro.skipA11y')}
            className="text-fc-muted text-sm hover:text-white transition"
          >
            {tr('intro.skip')}
          </button>
        </div>
      </div>
    </div>
  )
}
