import { useState } from 'react'
import { useT } from '../../i18n'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import PickerShell from '../ui/PickerShell'
import { Search, Smile } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import api, { mediaUrl } from '../../api/client'

const CATEGORIES = [
  {
    name: 'sw.emoji.smileys' as const,
    emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','😵','🤯','🤠','🥳','😎','🤓','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👻','👽','🤖'],
  },
  {
    name: 'sw.emoji.gestures' as const,
    emojis: ['👋','🤚','✋','🖖','👌','🤌','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🙏','💪','👀','👂','👃','👅','👄'],
  },
  {
    name: 'sw.emoji.hearts' as const,
    emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','🔥','✨','⭐','🌟','💫','🎉','🎊','🎈','🎁','🏆','🥇'],
  },
  {
    name: 'sw.emoji.animals' as const,
    emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🦟','🦗','🕷️','🦂','🐢','🦎','🐍','🐊','🦕','🦖','🐙','🦑','🦐','🦞','🦀','🐡','🐟','🐠','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🦧','🦣','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🦬'],
  },
  {
    name: 'sw.emoji.food' as const,
    emojis: ['🍏','🍎','🍊','🍋','🍌','🍉','🍇','🍓','🍈','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥕','🌽','🍄','🧄','🧅','🥔','🍞','🥐','🍕','🍔','🍟','🌭','🍿','🧂','🥚','🍳','🥞','🧇','🥓','🥩','🍗','🍖','🌮','🌯','🍱','🍣','🍜','🍝','🍛','🥗','🍲','🍙','🍚','🍘','🍥','🧁','🍰','🎂','🍭','🍫','🍩','🍪','☕','🍵','🧃','🥤','🧋','🍺','🍻','🥂','🍷','🥃','🍹'],
  },
  {
    name: 'sw.emoji.sports' as const,
    emojis: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🎱','🏓','🏸','🥊','🥋','⛳','🎣','🤿','🏋️','🤼','🤸','🏊','🚴','🏆','🥇','🥈','🥉','🏅','🎖️','🎯','🎳','🎮','🎰','🧩','🎲','♟️','🎭','🎨','🎬','🎤','🎧','🎸','🎹','🥁','🎺','🎷','🎻'],
  },
  {
    name: 'sw.emoji.nature' as const,
    emojis: ['🌸','🌺','🌻','🌹','🌷','🌼','🌱','🌿','🍀','🍁','🍂','🍃','🌾','🌲','🌳','🌴','🌵','🎋','🍄','🌊','🌀','🌈','❄️','☃️','⛄','🌤️','⛅','☁️','🌧️','⛈️','🌩️','🌨️','💨','💧','💦','⚡','🔥','🌙','⭐','🌟','☀️','🌍','🌎','🌏','🌋','⛰️','🏔️','🏕️','🏖️','🏜️','🏝️','🌃','🌆','🌇','🌉'],
  },
  {
    name: 'sw.emoji.objects' as const,
    emojis: ['🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','✈️','🚀','🛸','🚁','🛶','⛵','🚢','🛥️','🚤','🛳️','⛴️','🚂','🚃','🚄','🚅','🚆','🚇','🚊','🚉','🛺','🚲','🛴','🛵','🏍️','💺','⌚','📱','💻','🖥️','🖨️','⌨️','🖱️','📷','📸','📹','🎥','📽️','📺','📻','🎙️','📡','🔋','💡','🔦','🕯️','💰','💳','💎','⚗️','🔭','🔬','🧲','🔑','🗝️','🔒','🔓','🔨','🪓','⛏️','🔧','🔩','🪛','🧰','🗡️','⚔️','🛡️','🎁','🎀','🎊','🎉','🎈','🎂','🎗️','🏮','🧧','✉️','📬','📮','📦','📫','📚','📖','📝','✏️','🖊️','🖋️','📌','📍','📎','🖇️','✂️'],
  },
]

interface CustomEmoji {
  id: string
  name: string
  url: string
  server_id: string
  server_name: string
}

// Emojis récemment utilisés — persistés en localStorage, plus récent en premier
const RECENT_KEY = 'fc_recent_emojis'
const RECENT_MAX = 18
export function getRecentEmojis(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter(e => typeof e === 'string').slice(0, RECENT_MAX) : []
  } catch { return [] }
}
function pushRecentEmoji(emoji: string) {
  try {
    const next = [emoji, ...getRecentEmojis().filter(e => e !== emoji)].slice(0, RECENT_MAX)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {}
}

interface Props {
  onPick: (emoji: string) => void
  onClose: () => void
  serverId?: string
}

export default function EmojiPicker({ onPick, onClose, serverId }: Props) {
  const t = useT()
  useEscapeKey(onClose)
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState(0)
  const [tab, setTab] = useState<'standard' | 'server'>('standard')
  const [recents] = useState<string[]>(getRecentEmojis)
  const pick = (emoji: string) => {
    pushRecentEmoji(emoji)
    onPick(emoji)
    onClose()
  }

  // Emojis de TOUS ses serveurs, utilisables partout (gratuit, ce que Discord réserve à Nitro).
  // Serveur courant d'abord. Hors de ce serveur, un emoji s'écrit <:nom:id> (lu par utils/markdown).
  const { data: allEmojis = [] } = useQuery<CustomEmoji[]>({
    queryKey: ['my_emojis'],
    queryFn: () => api.get('/users/me/emojis').then(r => r.data),
    staleTime: 60_000,
  })
  const serverEmojis = [...allEmojis].sort((a, b) => Number(b.server_id === serverId) - Number(a.server_id === serverId))
  const tokenOf = (e: CustomEmoji) => (e.server_id === serverId ? `:${e.name}:` : `<:${e.name}:${e.id}>`)

  const filtered = search.trim()
    ? CATEGORIES.flatMap(c => c.emojis).filter(e => e.includes(search.toLowerCase()))
    : null

  const displayed = filtered ?? CATEGORIES[activeCategory].emojis

  return (
    <PickerShell
      onClose={onClose}
      desktopClassName="absolute bottom-full right-0 mb-2 bg-fc-channel border border-fc-hover rounded-xl shadow-2xl w-80 z-50 overflow-hidden"
    >
      {/* Barre de recherche */}
      <div role="search" aria-label={t('hc.emoji.search')} className="p-2 border-b border-fc-hover">
        <div className="flex items-center gap-2 bg-fc-input rounded-lg px-2 py-1.5">
          <Search size={14} aria-hidden className="text-fc-muted flex-shrink-0" />
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('hc.emoji.searchPh')}
            aria-label={t('hc.emoji.search')}
            enterKeyHint="search"
            inputMode="search"
            autoComplete="off"
            autoCapitalize="none"
            className="bg-transparent text-sm text-white outline-none flex-1 placeholder-fc-muted"
          />
        </div>
      </div>

      {/* Onglets Standard / Mes serveurs */}
      {allEmojis.length > 0 && (
        <div role="tablist" aria-label={t('hc.p.emojiType')} className="flex border-b border-fc-hover">
          <button
            role="tab"
            aria-selected={tab === 'standard'}
            onClick={() => setTab('standard')}
            className={`flex-1 py-1.5 text-xs font-semibold transition ${tab === 'standard' ? 'text-white border-b-2 border-fc-accent' : 'text-fc-muted hover:text-white'}`}
          >
            Standard
          </button>
          <button
            role="tab"
            aria-selected={tab === 'server'}
            onClick={() => setTab('server')}
            className={`flex-1 py-1.5 text-xs font-semibold transition ${tab === 'server' ? 'text-white border-b-2 border-fc-accent' : 'text-fc-muted hover:text-white'}`}
          >
            Mes serveurs ({serverEmojis.length})
          </button>
        </div>
      )}

      {tab === 'server' ? (
        <div className="h-52 overflow-y-auto overscroll-contain p-2">
          {serverEmojis.length === 0 ? (
            <div role="status" className="flex flex-col items-center justify-center h-full gap-2 text-fc-muted">
              <Smile size={32} className="opacity-30" aria-hidden />
              <p className="text-sm">{t('hc.emoji.noCustom')}</p>
              <p className="text-xs">{t('hc.emoji.noCustomHint')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {[...new Set(serverEmojis.map(e => e.server_id))].map(sid => {
                const liste = serverEmojis.filter(e => e.server_id === sid && (!search.trim() || e.name.includes(search.toLowerCase())))
                if (!liste.length) return null
                return (
                  <div key={sid}>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-fc-muted px-1 mb-1">{liste[0].server_name}</p>
                    <div className="grid grid-cols-8 gap-1">
                      {liste.map(emoji => (
                        <button
                          key={emoji.id}
                          onClick={() => { onPick(tokenOf(emoji)); onClose() }}
                          aria-label={`:${emoji.name}: (${emoji.server_name})`}
                          title={`:${emoji.name}: · ${emoji.server_name}`}
                          className="w-8 h-8 flex items-center justify-center rounded hover:bg-fc-hover transition hover:scale-110"
                        >
                          <img src={mediaUrl(emoji.url)} alt={emoji.name} loading="lazy" decoding="async" className="w-6 h-6 object-contain" />
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Onglets catégories standard */}
          {!filtered && (
            <div role="tablist" aria-label={t('hc.emoji.cats')} className="flex overflow-x-auto no-scrollbar border-b border-fc-hover px-1">
              {CATEGORIES.map((cat, i) => {
                const catName = t(cat.name)
                return (
                  <button
                    key={i}
                    role="tab"
                    aria-selected={activeCategory === i}
                    aria-label={catName}
                    onClick={() => setActiveCategory(i)}
                    className={`flex-shrink-0 px-2 py-1.5 text-base hover:bg-fc-hover/50 rounded transition
                      ${activeCategory === i ? 'border-b-2 border-fc-accent' : ''}`}
                  >
                    <span aria-hidden>{cat.emojis[0]}</span>
                  </button>
                )
              })}
            </div>
          )}

          {/* Grille emojis */}
          <div className="h-52 overflow-y-auto overscroll-contain p-2">
            {/* Récemment utilisés */}
            {!filtered && recents.length > 0 && (
              <>
                <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2 px-1" aria-hidden>
                  {t('hc.emoji.recent')}
                </div>
                <div className="grid grid-cols-9 gap-0.5 mb-2">
                  {recents.map((emoji, i) => (
                    <button
                      key={`r-${i}`}
                      onClick={() => pick(emoji)}
                      aria-label={emoji}
                      className="w-8 h-8 flex items-center justify-center text-xl rounded hover:bg-fc-hover transition hover:scale-110"
                    >
                      <span aria-hidden>{emoji}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {!filtered && (
              <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2 px-1" aria-hidden>
                {t(CATEGORIES[activeCategory].name)}
              </div>
            )}
            <div className="grid grid-cols-9 gap-0.5">
              {displayed.map((emoji, i) => (
                <button
                  key={i}
                  onClick={() => pick(emoji)}
                  aria-label={emoji}
                  className="w-8 h-8 flex items-center justify-center text-xl rounded hover:bg-fc-hover transition hover:scale-110"
                >
                  <span aria-hidden>{emoji}</span>
                </button>
              ))}
              {displayed.length === 0 && (
                <div role="status" className="col-span-9 text-center text-fc-muted text-sm py-6">{t('hc.emoji.none')}</div>
              )}
            </div>
          </div>
        </>
      )}
    </PickerShell>
  )
}
