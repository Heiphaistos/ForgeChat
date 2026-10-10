import api, { mediaUrl } from '../api/client'
import hljs from 'highlight.js/lib/common'
import { createContext, useContext, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { cachedChannel, cachedRole, cachedUsername } from './mentions'
import { deceptiveHost } from './safeUrl'
import UserName from '../components/ui/UserName'
import { intlLocale } from '../i18n'
import { useUxPrefs } from '../lib/uxPrefs'
import StillableImg from '../components/ui/StillableImg'

/** Vrai dans un salon que je modère (réglage « Spoilers : dans les salons que je modère »). */
export const SpoilerModContext = createContext(false)

// Lien d'invitation : masqué par le mode streamer (option « liens d'invitation »).
const inviteClass = (url: string) => (/\/invite\/[\w-]+/.test(url) ? 'streamer-invite' : undefined)

function highlightCode(code: string, lang: string): string {
  if (lang && hljs.getLanguage(lang)) {
    try { return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value } catch {}
  }
  try { return hljs.highlightAuto(code).value } catch {}
  return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Parser Markdown minimaliste compatible Discord
export function renderMarkdown(text: string | null | undefined, customEmojis?: Record<string, string>): React.ReactNode {
  if (!text || typeof text !== 'string') return null
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // Bloc de code ```
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      elements.push(
        <CodeBlock key={i} lang={lang} code={codeLines.join('\n')} />
      )
      i++
      continue
    }

    // Citation >
    if (line.startsWith('> ')) {
      elements.push(
        <blockquote key={i} className="border-l-4 border-fc-accent bg-fc-input/50 pl-3 py-0.5 rounded-r my-0.5 text-fc-muted italic">
          {inlineMarkdown(line.slice(2))}
        </blockquote>
      )
      i++
      continue
    }

    // Headers # / ## / ###
    if (line.startsWith('### ')) {
      elements.push(<h3 key={i} className="text-base font-semibold text-white mt-1 mb-0.5">{inlineMarkdown(line.slice(4), customEmojis)}</h3>)
      i++; continue
    }
    if (line.startsWith('## ')) {
      elements.push(<h2 key={i} className="text-lg font-bold text-white mt-1 mb-0.5">{inlineMarkdown(line.slice(3), customEmojis)}</h2>)
      i++; continue
    }
    if (line.startsWith('# ')) {
      elements.push(<h1 key={i} className="text-xl font-bold text-white mt-1 mb-0.5">{inlineMarkdown(line.slice(2), customEmojis)}</h1>)
      i++; continue
    }

    // Liste à puces - / *
    if (/^[*-] /.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^[*-] /.test(lines[i])) {
        items.push(lines[i].slice(2))
        i++
      }
      elements.push(
        <ul key={`ul-${i}`} className="list-disc list-inside my-0.5 space-y-0.5 pl-1">
          {items.map((item, idx) => <li key={idx}>{inlineMarkdown(item, customEmojis)}</li>)}
        </ul>
      )
      continue
    }

    // Liste numérotée 1. 2. …
    if (/^\d+\. /.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\. /, ''))
        i++
      }
      elements.push(
        <ol key={`ol-${i}`} className="list-decimal list-inside my-0.5 space-y-0.5 pl-1">
          {items.map((item, idx) => <li key={idx}>{inlineMarkdown(item, customEmojis)}</li>)}
        </ol>
      )
      continue
    }

    // Ligne vide
    if (line.trim() === '') {
      elements.push(<br key={i} />)
      i++
      continue
    }

    // Ligne normale avec inline markdown
    elements.push(<span key={i} style={{ display: 'block' }}>{inlineMarkdown(line, customEmojis)}</span>)
    i++
  }

  return <div className="fc-markdown">{elements}</div>
}

function inlineMarkdown(text: string, customEmojis?: Record<string, string>): React.ReactNode {
  const parts = tokenize(text, customEmojis)
  return <>{parts}</>
}

// Timestamp Discord-style : <t:1234567890:R> → "il y a 2 heures"
function formatRelativeTime(unix: number): string {
  const now = Date.now()
  const diff = now - unix * 1000
  const abs = Math.abs(diff)
  const future = diff < 0

  const seconds = Math.floor(abs / 1000)
  const minutes = Math.floor(abs / 60000)
  const hours = Math.floor(abs / 3600000)
  const days = Math.floor(abs / 86400000)

  let label: string
  if (seconds < 60) label = 'à l\'instant'
  else if (minutes < 60) label = `${minutes} minute${minutes > 1 ? 's' : ''}`
  else if (hours < 24) label = `${hours} heure${hours > 1 ? 's' : ''}`
  else label = `${days} jour${days > 1 ? 's' : ''}`

  if (seconds < 60) return label
  return future ? `dans ${label}` : `il y a ${label}`
}

function tokenize(text: string, customEmojis?: Record<string, string>): React.ReactNode[] {
  // __/_ exigent une frontière de mot (comme CommonMark) -- sinon un identifiant
  // comme max_retries_value se retrouvait partiellement italicisé (_retries_).
  const pattern = /(`[^`]+`|\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|(?<![\w_])__(.+?)__(?![\w_])|(?<![\w_])_(.+?)_(?![\w_])|~~(.+?)~~|\|\|(.+?)\|\||<a?:[a-z0-9_]{1,32}:[0-9a-f-]{36}>|<@[^>]+>|<#[0-9a-f-]{36}>|<t:\d+:[RrDdFftT]>|@everyone|@here|@\w+|\[([^\]]+)\]\((https?:\/\/[^)]+)\)|https?:\/\/\S+|:[a-z0-9_]+:)/g
  const result: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    // Texte avant
    if (match.index > lastIndex) {
      result.push(text.slice(lastIndex, match.index))
    }

    const full = match[0]

    if (full.startsWith('`') && full.endsWith('`')) {
      result.push(<code key={match.index}>{full.slice(1, -1)}</code>)
    } else if (full.startsWith('***') && full.endsWith('***')) {
      result.push(<strong key={match.index}><em>{full.slice(3, -3)}</em></strong>)
    } else if (full.startsWith('**') && full.endsWith('**')) {
      result.push(<strong key={match.index}>{full.slice(2, -2)}</strong>)
    } else if (full.startsWith('__') && full.endsWith('__')) {
      // Vérifié AVANT le cas <em> ci-dessous : "__x__" satisfait aussi
      // startsWith('_')/endsWith('_'), qui rendait cette branche inatteignable
      // (affichait "_x_" en italique au lieu d'un soulignement).
      result.push(<u key={match.index}>{full.slice(2, -2)}</u>)
    } else if ((full.startsWith('*') && full.endsWith('*')) || (full.startsWith('_') && full.endsWith('_'))) {
      result.push(<em key={match.index}>{full.slice(1, -1)}</em>)
    } else if (full.startsWith('~~') && full.endsWith('~~')) {
      result.push(<del key={match.index}>{full.slice(2, -2)}</del>)
    } else if (full.startsWith('||') && full.endsWith('||')) {
      result.push(
        <SpoilerText key={match.index} text={full.slice(2, -2)} />
      )
    } else if (full === '@everyone' || full === '@here') {
      result.push(
        <span key={match.index} className="mention mention-everyone">{full}</span>
      )
    } else if (full.startsWith('<@')) {
      result.push(<MentionChip key={match.index} raw={full} />)
    } else if (full.startsWith('@') && full.length > 1) {
      result.push(<span key={match.index} className="mention">{full}</span>)
    } else if (full.startsWith('<t:')) {
      // Timestamp Discord-style <t:1234567890:R>
      const tsMatch = full.match(/^<t:(\d+):([RrDdFftT])>$/)
      if (tsMatch) {
        const unix = parseInt(tsMatch[1], 10)
        const fmt = tsMatch[2]
        let display: string
        if (fmt === 'R' || fmt === 'r') {
          display = formatRelativeTime(unix)
        } else {
          display = new Date(unix * 1000).toLocaleString(intlLocale(), {
            dateStyle: fmt === 'd' || fmt === 'D' ? 'short' : undefined,
            timeStyle: fmt === 't' || fmt === 'T' ? 'short' : undefined,
          })
        }
        result.push(
          <span key={match.index} className="bg-fc-hover/60 rounded px-1 text-fc-accent font-medium text-xs" title={new Date(unix * 1000).toLocaleString(intlLocale())}>
            {display}
          </span>
        )
      } else {
        result.push(full)
      }
    } else if (full.startsWith('[')) {
      // Lien Markdown [texte](url)
      const linkMatch = full.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/)
      if (linkMatch) {
        // Texte qui imite une autre adresse que la cible : l'hôte réel est affiché à côté.
        const real = deceptiveHost(linkMatch[1], linkMatch[2])
        result.push(
          <a key={match.index} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" title={linkMatch[2]} className={inviteClass(linkMatch[2])}>
            {linkMatch[1]}{real && <span className="text-fc-yellow"> ({real})</span>}
          </a>
        )
      } else {
        result.push(full)
      }
    } else if (full.startsWith('http')) {
      // Détache la ponctuation de fin de phrase (. , ; : ! ? guillemets) du lien --
      // sinon "voir https://exemple.com/page." capture le point final dans le href.
      // La parenthèse fermante n'est détachée que si elle n'a pas de `(` correspondant
      // dans l'URL (sinon on casserait des liens Wikipedia du type .../Foo_(bar)).
      let url = full
      let trailing = ''
      const trailingChars = /[.,;:!?'"]+$/
      const m = url.match(trailingChars)
      if (m) { trailing = m[0]; url = url.slice(0, -m[0].length) }
      while (url.endsWith(')') && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) {
        trailing = ')' + trailing
        url = url.slice(0, -1)
      }
      result.push(
        <a key={match.index} href={url} target="_blank" rel="noopener noreferrer" className={inviteClass(url)}>
          {url}
        </a>
      )
      if (trailing) result.push(trailing)
    } else if (/^<#[0-9a-f-]{36}>$/.test(full)) {
      // Mention de salon : #nom cliquable si le salon est connu (même rendu que le mobile).
      const ch = cachedChannel(full.slice(2, -1))
      result.push(ch?.server_id
        ? <Link key={match.index} to={`/servers/${ch.server_id}/channels/${ch.id}`} className="mention">#{ch.name}</Link>
        : <span key={match.index} className="mention">#{ch?.name ?? 'salon-inconnu'}</span>)
    } else if (/^<a?:[a-z0-9_]{1,32}:[0-9a-f-]{36}>$/.test(full)) {
      // Emoji d'un autre serveur (<:nom:id>) : affiché partout, même hors de ce serveur.
      const [, name, id] = full.slice(1, -1).split(':')
      result.push(<RemoteEmoji key={match.index} id={id} name={name} />)
    } else if (full.startsWith(':') && full.endsWith(':') && customEmojis) {
      const name = full.slice(1, -1)
      const url = customEmojis[name]
      if (url) {
        result.push(
          <StillableImg key={match.index} src={mediaUrl(url)} alt={name} title={`:${name}:`}
            loading="lazy" decoding="async"
            className="inline-block w-5 h-5 object-contain align-middle mx-0.5" />
        )
      } else {
        result.push(full)
      }
    } else {
      result.push(full)
    }

    lastIndex = match.index + full.length
  }

  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex))
  }

  return result
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div className="bg-[#1e1f29] rounded-lg mt-1 mb-1 overflow-hidden border border-white/5">
      <div className="flex items-center justify-between px-3 py-1 bg-black/30 border-b border-white/5">
        <span className="text-xs text-fc-muted font-mono">{lang || 'code'}</span>
        <button
          onClick={copy}
          className="text-xs text-fc-muted hover:text-white transition px-1.5 py-0.5 rounded hover:bg-white/10"
        >
          {copied ? '✓ Copié' : 'Copier'}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-sm font-mono whitespace-pre leading-relaxed hljs">
        <code dangerouslySetInnerHTML={{ __html: highlightCode(code, lang) }} />
      </pre>
    </div>
  )
}

function SpoilerText({ text }: { text: string }) {
  const mode = useUxPrefs(s => s.spoilers)
  const moderated = useContext(SpoilerModContext)
  const [clicked, setRevealed] = useState(false)
  // Révélé d'office : réglage « toujours », ou « salons que je modère » ; fond léger pour le repérer.
  const auto = mode === 'always' || (mode === 'moderated' && moderated)
  const revealed = clicked || auto
  const reveal = () => setRevealed(true)
  return (
    <span
      onClick={reveal}
      onKeyDown={e => { if (!revealed && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); reveal() } }}
      role={revealed ? undefined : 'button'}
      tabIndex={revealed ? undefined : 0}
      aria-label={revealed ? undefined : 'Contenu masqué — cliquer pour révéler'}
      className={`rounded px-0.5 cursor-pointer transition-colors ${
        revealed ? `${auto && !clicked ? 'bg-fc-muted/20' : 'bg-transparent'} cursor-default` : 'bg-fc-muted/40 text-transparent select-none hover:bg-fc-muted/60'
      }`}
    >
      {text}
    </span>
  )
}

// Jeton <@id> / <@&id> (voir utils/mentions.ts) affiché en @pseudo / @rôle.
// Nom pris dans le cache (membres, rôles, profils) ; sinon profil chargé une fois.
function MentionChip({ raw }: { raw: string }) {
  const m = raw.match(/^<@([&!]?)([0-9a-fA-F-]{36})>$/)
  const isRole = m?.[1] === '&'
  const id = m?.[2] ?? ''
  const role = isRole ? cachedRole(id) : undefined
  const known = isRole ? role?.name : cachedUsername(id)
  const { data } = useQuery<{ username?: string }>({
    queryKey: ['user', id],
    queryFn: () => api.get(`/users/${id}`).then(r => r.data),
    enabled: !!id && !isRole && !known,
    staleTime: 60_000,
  })
  if (!m) return <>{raw}</>
  const name = known ?? data?.username ?? (isRole ? 'rôle-supprimé' : 'utilisateur')
  const color = role?.color ? `#${role.color.toString(16).padStart(6, '0')}` : undefined
  return (
    <span className="mention" style={color ? { color, background: `${color}26` } : undefined}>
      @{isRole ? name : <UserName userId={id} name={name} />}
    </span>
  )
}

/** Emoji d'un autre serveur : son image est retrouvée par identifiant (GET /emojis/:id, en cache). */
function RemoteEmoji({ id, name }: { id: string; name: string }) {
  const { data } = useQuery<{ url: string }>({
    queryKey: ['emoji', id],
    queryFn: () => api.get(`/emojis/${id}`).then(r => r.data),
    staleTime: Infinity,
    retry: false,
  })
  if (!data?.url) return <>{`:${name}:`}</>
  return (
    <StillableImg src={mediaUrl(data.url)} alt={name} title={`:${name}:`} loading="lazy" decoding="async"
      className="inline-block w-5 h-5 object-contain align-middle mx-0.5" />
  )
}
