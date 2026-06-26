import { useState } from 'react'

interface Props {
  onDone: () => void
}

const STEPS = [
  {
    title: 'Bienvenue sur ForgeChat',
    description: 'Votre messagerie self-hosted. Créez des serveurs, invitez vos amis, et discutez en temps réel.',
    emoji: '💬',
  },
  {
    title: 'Découvrez les serveurs',
    description: 'Rejoignez ou créez des serveurs thématiques avec des canaux textuels et vocaux.',
    emoji: '🌐',
  },
  {
    title: 'Notifications & sons',
    description: 'Personnalisez vos notifications dans Paramètres > Notifications pour ne rien manquer.',
    emoji: '🔔',
  },
  {
    title: "C'est parti !",
    description: 'Tout est prêt. Explorez ForgeChat et rejoignez la conversation !',
    emoji: '🚀',
  },
]

export default function Onboarding({ onDone }: Props) {
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
      <div className="bg-fc-sidebar rounded-2xl p-8 max-w-md w-full shadow-2xl flex flex-col gap-6">
        <div className="flex justify-center gap-2">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`w-2.5 h-2.5 rounded-full transition-colors ${
                i <= step ? 'bg-fc-accent' : 'bg-fc-hover'
              }`}
            />
          ))}
        </div>

        <div className="flex flex-col items-center text-center gap-3">
          <span className="text-5xl">{current.emoji}</span>
          <h2 className="text-xl font-bold text-white">{current.title}</h2>
          <p className="text-fc-muted text-sm leading-relaxed">{current.description}</p>
        </div>

        <div className="flex flex-col items-center gap-3">
          <button
            onClick={next}
            className="w-full bg-fc-accent hover:bg-fc-accent/80 text-white font-semibold py-2.5 rounded-xl transition"
          >
            {step < STEPS.length - 1 ? 'Suivant' : 'Commencer'}
          </button>
          <button
            onClick={finish}
            className="text-fc-muted text-sm hover:text-white transition"
          >
            Passer
          </button>
        </div>
      </div>
    </div>
  )
}
