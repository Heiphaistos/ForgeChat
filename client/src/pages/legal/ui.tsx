import type { ReactNode } from 'react'

// Briques communes aux textes légaux (fr.tsx, en.tsx).
const CONTACT = 'contact.forgeinformatique@heiphaistos.org'

export function Mail() {
  return <a href={`mailto:${CONTACT}`} className="text-fc-accent hover:underline break-all">{CONTACT}</a>
}

export function Ext({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className="text-fc-accent hover:underline">{children}</a>
}

export function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-fc-muted">{children}</div>
    </section>
  )
}
