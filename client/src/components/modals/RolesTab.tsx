import { useState } from 'react'
import { Plus, Trash2, Save, Shield, ChevronDown, ChevronRight } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../../api/client'
import toast from 'react-hot-toast'

// Utilise des puissances de 2 comme nombres JS (safe jusqu'à 2**52 avec Number)
const B = (n: number) => Math.pow(2, n)

// 50+ permissions organisées par groupe
const PERMISSION_GROUPS = [
  {
    key: 'admin',
    label: 'Administration',
    color: 'text-red-400',
    perms: [
      { key: 'ADMINISTRATOR',         bit: B(0),  label: 'Administrateur',              desc: 'Toutes les permissions, bypass tous les overrides' },
      { key: 'VIEW_AUDIT_LOG',         bit: B(1),  label: 'Voir le journal d\'audit',    desc: 'Voir les actions de modération dans le journal' },
      { key: 'MANAGE_SERVER',          bit: B(2),  label: 'Gérer le serveur',            desc: 'Modifier le nom, l\'icône, la région' },
      { key: 'VIEW_GUILD_INSIGHTS',    bit: B(3),  label: 'Voir les statistiques',       desc: 'Accéder aux analytics du serveur' },
      { key: 'MANAGE_WEBHOOKS',        bit: B(4),  label: 'Gérer les webhooks',          desc: 'Créer, modifier, supprimer des webhooks' },
      { key: 'MANAGE_EMOJIS',         bit: B(5),  label: 'Gérer les emojis & stickers', desc: 'Ajouter, modifier, supprimer des emojis custom' },
      { key: 'MANAGE_BOTS',           bit: B(6),  label: 'Gérer les bots',              desc: 'Ajouter et gérer les bots du serveur' },
      { key: 'MANAGE_EVENTS',         bit: B(7),  label: 'Gérer les événements',        desc: 'Créer, modifier, supprimer les événements' },
      { key: 'CREATE_EVENTS',         bit: B(8),  label: 'Créer des événements',        desc: 'Peut créer des événements sans les gérer' },
    ]
  },
  {
    key: 'members',
    label: 'Gestion des membres',
    color: 'text-orange-400',
    perms: [
      { key: 'CREATE_INVITE',         bit: B(9),  label: 'Créer des invitations',       desc: 'Créer des liens d\'invitation vers le serveur' },
      { key: 'CHANGE_NICKNAME',       bit: B(10), label: 'Changer son surnom',          desc: 'Peut modifier son propre surnom' },
      { key: 'MANAGE_NICKNAMES',      bit: B(11), label: 'Gérer les surnoms',           desc: 'Modifier les surnoms des autres membres' },
      { key: 'KICK_MEMBERS',          bit: B(12), label: 'Expulser des membres',        desc: 'Expulser des membres du serveur' },
      { key: 'BAN_MEMBERS',           bit: B(13), label: 'Bannir des membres',          desc: 'Bannir définitivement des membres' },
      { key: 'MODERATE_MEMBERS',      bit: B(14), label: 'Mettre en sourdine (timeout)', desc: 'Mettre temporairement en sourdine des membres' },
      { key: 'MANAGE_ROLES_BELOW',    bit: B(15), label: 'Gérer les rôles inférieurs',  desc: 'Attribuer/retirer des rôles inférieurs au sien' },
      { key: 'MANAGE_ROLES',          bit: B(16), label: 'Gérer les rôles',             desc: 'Créer, modifier, supprimer des rôles' },
      { key: 'VIEW_MEMBER_LIST',      bit: B(17), label: 'Voir la liste des membres',   desc: 'Accéder à la liste complète des membres' },
    ]
  },
  {
    key: 'channels',
    label: 'Salons texte',
    color: 'text-blue-400',
    perms: [
      { key: 'VIEW_CHANNEL',          bit: B(18), label: 'Voir les salons',             desc: 'Voir les salons et leur historique' },
      { key: 'MANAGE_CHANNELS',       bit: B(19), label: 'Gérer les salons',            desc: 'Créer, modifier, supprimer des salons' },
      { key: 'SEND_MESSAGES',         bit: B(20), label: 'Envoyer des messages',        desc: 'Écrire des messages dans les salons texte' },
      { key: 'SEND_TTS_MESSAGES',     bit: B(21), label: 'Envoyer des messages TTS',    desc: 'Utiliser /tts pour la synthèse vocale' },
      { key: 'MANAGE_MESSAGES',       bit: B(22), label: 'Gérer les messages',          desc: 'Supprimer et épingler les messages des autres' },
      { key: 'EMBED_LINKS',           bit: B(23), label: 'Intégrer des liens',          desc: 'Générer des aperçus de liens (embeds)' },
      { key: 'ATTACH_FILES',          bit: B(24), label: 'Joindre des fichiers',        desc: 'Envoyer des fichiers et images' },
      { key: 'READ_MESSAGE_HISTORY',  bit: B(25), label: 'Lire l\'historique',          desc: 'Voir les messages précédents dans un salon' },
      { key: 'MENTION_EVERYONE',      bit: B(26), label: 'Mentionner @everyone',        desc: 'Mentionner @everyone, @here, et tous les rôles' },
      { key: 'USE_EXTERNAL_EMOJIS',   bit: B(27), label: 'Emojis externes',            desc: 'Utiliser des emojis de serveurs externes' },
      { key: 'USE_EXTERNAL_STICKERS', bit: B(28), label: 'Stickers externes',          desc: 'Utiliser des stickers de serveurs externes' },
      { key: 'ADD_REACTIONS',         bit: B(29), label: 'Ajouter des réactions',      desc: 'Réagir aux messages avec des emojis' },
      { key: 'USE_SLASH_COMMANDS',    bit: B(30), label: 'Utiliser les slash commands', desc: 'Utiliser les commandes / des bots' },
      { key: 'USE_APPLICATION_CMDS',  bit: B(31), label: 'Commandes d\'application',   desc: 'Utiliser les interactions des applications' },
      { key: 'MANAGE_PINS',           bit: B(32), label: 'Gérer les messages épinglés', desc: 'Épingler et désépingler des messages' },
    ]
  },
  {
    key: 'threads',
    label: 'Fils de discussion',
    color: 'text-purple-400',
    perms: [
      { key: 'CREATE_PUBLIC_THREADS',  bit: B(33), label: 'Créer des fils publics',     desc: 'Créer des fils de discussion publics' },
      { key: 'CREATE_PRIVATE_THREADS', bit: B(34), label: 'Créer des fils privés',      desc: 'Créer des fils de discussion privés' },
      { key: 'SEND_IN_THREADS',        bit: B(35), label: 'Envoyer dans les fils',      desc: 'Envoyer des messages dans les fils' },
      { key: 'MANAGE_THREADS',         bit: B(36), label: 'Gérer les fils',             desc: 'Archiver, supprimer et gérer les fils' },
      { key: 'USE_THREADS',            bit: B(37), label: 'Voir les fils',              desc: 'Accéder aux fils de discussion' },
    ]
  },
  {
    key: 'voice',
    label: 'Vocal & Vidéo',
    color: 'text-green-400',
    perms: [
      { key: 'CONNECT_VOICE',          bit: B(38), label: 'Rejoindre la voix',          desc: 'Accéder aux canaux vocaux' },
      { key: 'SPEAK',                  bit: B(39), label: 'Parler',                     desc: 'Parler dans les canaux vocaux' },
      { key: 'STREAM',                 bit: B(40), label: 'Partager l\'écran / Go Live', desc: 'Partager son écran ou la caméra' },
      { key: 'USE_VAD',                bit: B(41), label: 'Détection d\'activité vocale', desc: 'Parler sans maintenir un bouton (VAD)' },
      { key: 'PRIORITY_SPEAKER',       bit: B(42), label: 'Orateur prioritaire',        desc: 'Voix amplifiée, autres atténuées' },
      { key: 'MUTE_MEMBERS_VOICE',     bit: B(43), label: 'Rendre muet (voix)',         desc: 'Couper le micro des autres en vocal' },
      { key: 'DEAFEN_MEMBERS_VOICE',   bit: B(44), label: 'Rendre sourd (voix)',        desc: 'Couper le son des autres en vocal' },
      { key: 'MOVE_MEMBERS',          bit: B(45), label: 'Déplacer des membres',       desc: 'Déplacer des membres entre salons vocaux' },
      { key: 'USE_SOUNDBOARD',         bit: B(46), label: 'Utiliser le soundboard',     desc: 'Jouer des sons depuis le soundboard' },
      { key: 'USE_EMBEDDED_ACTIVITIES', bit: B(47), label: 'Activités intégrées',       desc: 'Jouer à des jeux ou utiliser des apps vocales' },
      { key: 'REQUEST_TO_SPEAK',       bit: B(48), label: 'Demander la parole (Stage)', desc: 'Demander la parole dans les canaux Stage' },
    ]
  },
  {
    key: 'forum',
    label: 'Forums & Annonces',
    color: 'text-yellow-400',
    perms: [
      { key: 'CREATE_POSTS',           bit: B(49), label: 'Créer des posts de forum',   desc: 'Créer des posts dans les salons forum' },
      { key: 'MANAGE_POSTS',           bit: B(50), label: 'Gérer les posts de forum',   desc: 'Modifier et supprimer les posts des autres' },
      { key: 'SEND_ANNOUNCEMENTS',     bit: B(51), label: 'Envoyer des annonces',       desc: 'Envoyer des messages dans les salons d\'annonces' },
      { key: 'FOLLOW_CHANNELS',        bit: B(52), label: 'Suivre des salons',          desc: 'Abonner des salons à des flux d\'annonces' },
    ]
  },
]

// Flatten pour usage
const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap(g => g.perms)
const ADMIN_BIT = B(0)

function colorIntToHex(c: number): string {
  return '#' + (c >>> 0).toString(16).padStart(6, '0')
}
function hexToColorInt(h: string): number {
  return parseInt(h.replace('#', ''), 16)
}

function hasBit(perms: number, bit: number): boolean {
  if (bit <= 0x80000000) return (perms & bit) !== 0
  // Pour les grands bits, utiliser une approche différente
  // On convertit en BigInt temporairement
  return (BigInt(Math.round(perms)) & BigInt(Math.round(bit))) !== 0n
}

function toggleBit(perms: number, bit: number): number {
  if (hasBit(perms, bit)) return perms - bit
  return perms + bit
}

interface Role {
  id: string
  name: string
  color: number
  permissions: number
  position: number
  mentionable: boolean
  hoisted: boolean
  is_everyone: boolean
}

function PermGroup({
  group, perms, onChange, disabled,
}: { group: typeof PERMISSION_GROUPS[0]; perms: number; onChange: (p: number) => void; disabled: boolean }) {
  const [open, setOpen] = useState(true)
  const enabledCount = group.perms.filter(p => hasBit(perms, p.bit)).length

  const checkAll = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (disabled) return
    let p = perms
    for (const perm of group.perms) {
      if (!hasBit(p, perm.bit)) p = p + perm.bit
    }
    onChange(p)
  }

  const uncheckAll = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (disabled) return
    let p = perms
    for (const perm of group.perms) {
      if (hasBit(p, perm.bit)) p = p - perm.bit
    }
    onChange(p)
  }

  return (
    <div className="border border-fc-hover rounded-xl overflow-hidden mb-2">
      {/* div instead of button to avoid nested interactive content (invalid HTML) */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-fc-channel hover:bg-fc-hover/50 transition cursor-pointer"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown size={14} className="text-fc-muted" /> : <ChevronRight size={14} className="text-fc-muted" />}
          <span className={`text-sm font-semibold ${group.color}`}>{group.label}</span>
          <span className="text-xs text-fc-muted">({enabledCount}/{group.perms.length})</span>
        </div>
        {!disabled && (
          <div className="flex gap-1 ml-2" onClick={e => e.stopPropagation()}>
            <button
              onClick={checkAll}
              className="px-2 py-0.5 text-[10px] rounded bg-fc-accent/20 text-fc-accent hover:bg-fc-accent/30 transition font-medium"
              title="Tout cocher dans cette catégorie"
            >Tout</button>
            <button
              onClick={uncheckAll}
              className="px-2 py-0.5 text-[10px] rounded bg-fc-red/20 text-fc-red hover:bg-fc-red/30 transition font-medium"
              title="Tout décocher dans cette catégorie"
            >Aucun</button>
          </div>
        )}
      </div>
      {open && (
        <div className="px-2 py-1.5 space-y-0.5">
          {group.perms.map(p => {
            const on = disabled || hasBit(perms, p.bit)
            return (
              <label key={p.key}
                className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-fc-hover/30 cursor-pointer transition select-none group">
                <div className="flex-1 min-w-0 pr-3">
                  <div className="text-sm text-white font-medium">{p.label}</div>
                  <div className="text-xs text-fc-muted truncate">{p.desc}</div>
                </div>
                <div
                  onClick={() => { if (!disabled) onChange(toggleBit(perms, p.bit)) }}
                  className={`w-11 h-6 rounded-full relative transition flex-shrink-0 cursor-pointer
                    ${on ? 'bg-fc-accent' : 'bg-fc-hover'} ${disabled && !hasBit(perms, p.bit) ? 'opacity-50' : ''}`}
                >
                  <div className={`w-4.5 h-4.5 w-[18px] h-[18px] bg-white rounded-full absolute top-[3px] transition-all shadow
                    ${on ? 'left-[23px]' : 'left-[3px]'}`} />
                </div>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function RolesTab({ serverId }: { serverId: string }) {
  const qc = useQueryClient()
  const [selected, setSelected] = useState<Role | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('#7289da')
  const [editPerms, setEditPerms] = useState(0)
  const [editHoisted, setEditHoisted] = useState(false)
  const [editMentionable, setEditMentionable] = useState(false)
  const [newName, setNewName] = useState('')
  const [activeTab, setActiveTab] = useState<'info' | 'perms' | 'members'>('info')

  const { data: roles = [] } = useQuery<Role[]>({
    queryKey: ['roles', serverId],
    queryFn: () => api.get(`/servers/${serverId}/roles`).then(r => r.data),
  })

  const selectRole = (r: Role) => {
    setSelected(r)
    setEditName(r.name)
    setEditColor(colorIntToHex(r.color))
    setEditPerms(r.permissions)
    setEditHoisted(r.hoisted)
    setEditMentionable(r.mentionable)
    setActiveTab('info')
  }

  const createRole = useMutation({
    mutationFn: (name: string) => api.post(`/servers/${serverId}/roles`, { name }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['roles', serverId] })
      setNewName('')
      if (res.data) selectRole(res.data)
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const saveRole = useMutation({
    mutationFn: () => api.patch(`/servers/${serverId}/roles/${selected!.id}`, {
      name: editName,
      color: hexToColorInt(editColor),
      permissions: editPerms,
      hoisted: editHoisted,
      mentionable: editMentionable,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roles', serverId] })
      toast.success('Rôle sauvegardé')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const deleteRole = useMutation({
    mutationFn: (roleId: string) => api.delete(`/servers/${serverId}/roles/${roleId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roles', serverId] })
      setSelected(null)
      toast.success('Rôle supprimé')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const isAdmin = hasBit(editPerms, ADMIN_BIT)

  const totalEnabled = ALL_PERMISSIONS.filter(p => hasBit(editPerms, p.bit)).length

  return (
    <div className="flex gap-4 h-full min-h-0">
      {/* Liste rôles */}
      <div className="w-52 flex-shrink-0 flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            value={newName} onChange={e => setNewName(e.target.value)}
            placeholder="Nouveau rôle"
            className="flex-1 px-2 py-1.5 bg-fc-input rounded text-white text-xs outline-none focus:ring-1 focus:ring-fc-accent"
            onKeyDown={e => e.key === 'Enter' && newName.trim() && createRole.mutate(newName.trim())}
          />
          <button
            onClick={() => newName.trim() && createRole.mutate(newName.trim())}
            disabled={!newName.trim() || createRole.isPending}
            className="p-1.5 bg-fc-accent hover:bg-indigo-500 text-white rounded transition disabled:opacity-50"
            title="Créer"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto space-y-0.5">
          {(roles as Role[]).sort((a, b) => b.position - a.position).map(r => (
            <button key={r.id} onClick={() => selectRole(r)}
              className={`w-full text-left px-2.5 py-2 rounded-lg text-sm flex items-center gap-2 transition group
                ${selected?.id === r.id ? 'bg-fc-accent/20 text-white' : 'text-fc-muted hover:text-white hover:bg-fc-hover/50'}`}
            >
              <div className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: r.color ? colorIntToHex(r.color) : '#99aab5' }} />
              <span className="truncate flex-1">{r.name}</span>
              {r.hoisted && <span className="text-[9px] text-fc-muted/60 group-hover:text-fc-muted">H</span>}
              {r.mentionable && <span className="text-[9px] text-fc-muted/60 group-hover:text-fc-muted">@</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Éditeur rôle */}
      {selected ? (
        <div className="flex-1 flex flex-col min-h-0 gap-3">
          {/* Header */}
          <div className="flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full" style={{ backgroundColor: editColor }} />
              <h3 className="font-bold text-white">{selected.name}</h3>
              {isAdmin && (
                <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full font-semibold flex items-center gap-0.5">
                  <Shield size={9}/> ADMIN
                </span>
              )}
              <span className="text-xs text-fc-muted">{totalEnabled}/{ALL_PERMISSIONS.length} permissions</span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => saveRole.mutate()} disabled={saveRole.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-xs font-medium transition disabled:opacity-50">
                <Save size={12}/>
                {saveRole.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
              </button>
              {!selected.is_everyone && (
                <button onClick={() => { if (window.confirm('Supprimer ce rôle ?')) deleteRole.mutate(selected.id) }}
                  className="p-1.5 text-fc-muted hover:text-red-400 hover:bg-red-500/10 rounded-lg transition" title="Supprimer">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-fc-hover flex-shrink-0">
            {(['info', 'perms', 'members'] as const).map(t => (
              <button key={t} onClick={() => setActiveTab(t)}
                className={`px-3 py-1.5 text-sm font-medium transition rounded-t-lg
                  ${activeTab === t ? 'text-white border-b-2 border-fc-accent' : 'text-fc-muted hover:text-white'}`}>
                {t === 'info' ? 'Informations' : t === 'perms' ? 'Permissions' : 'Membres'}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* Tab: Informations */}
            {activeTab === 'info' && (
              <div className="space-y-4 pr-1">
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1.5 block">Nom du rôle</label>
                    <input value={editName} onChange={e => setEditName(e.target.value)}
                      disabled={selected.is_everyone}
                      className="w-full px-3 py-2 bg-fc-input rounded-lg text-white text-sm outline-none focus:ring-2 focus:ring-fc-accent disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1.5 block">Couleur</label>
                    <div className="flex items-center gap-2">
                      <input type="color" value={editColor} onChange={e => setEditColor(e.target.value)}
                        className="w-10 h-[38px] rounded-lg cursor-pointer border-0 bg-transparent p-0.5"
                      />
                      <input value={editColor} onChange={e => setEditColor(e.target.value)}
                        className="w-24 px-2 py-2 bg-fc-input rounded-lg text-white text-xs outline-none font-mono"
                        placeholder="#7289da"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-3 block">Options</label>
                  <div className="space-y-3">
                    <label className="flex items-center justify-between px-4 py-3 bg-fc-channel rounded-xl cursor-pointer hover:bg-fc-hover/40 transition select-none">
                      <div>
                        <div className="text-sm text-white font-medium">Afficher séparément dans la liste</div>
                        <div className="text-xs text-fc-muted">Les membres avec ce rôle apparaissent dans leur propre groupe (hoist)</div>
                      </div>
                      <div onClick={() => setEditHoisted(v => !v)}
                        className={`w-11 h-6 rounded-full relative transition flex-shrink-0 ml-4 cursor-pointer ${editHoisted ? 'bg-fc-accent' : 'bg-fc-hover'}`}>
                        <div className={`w-[18px] h-[18px] bg-white rounded-full absolute top-[3px] transition-all shadow ${editHoisted ? 'left-[23px]' : 'left-[3px]'}`} />
                      </div>
                    </label>
                    <label className="flex items-center justify-between px-4 py-3 bg-fc-channel rounded-xl cursor-pointer hover:bg-fc-hover/40 transition select-none">
                      <div>
                        <div className="text-sm text-white font-medium">Permettre @mention du rôle</div>
                        <div className="text-xs text-fc-muted">Tout le monde peut mentionner ce rôle pour notifier ses membres</div>
                      </div>
                      <div onClick={() => setEditMentionable(v => !v)}
                        className={`w-11 h-6 rounded-full relative transition flex-shrink-0 ml-4 cursor-pointer ${editMentionable ? 'bg-fc-accent' : 'bg-fc-hover'}`}>
                        <div className={`w-[18px] h-[18px] bg-white rounded-full absolute top-[3px] transition-all shadow ${editMentionable ? 'left-[23px]' : 'left-[3px]'}`} />
                      </div>
                    </label>
                  </div>
                </div>

                <div className="bg-fc-channel rounded-xl p-4">
                  <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">Aperçu</div>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-fc-accent flex items-center justify-center text-white font-bold text-sm">A</div>
                    <div>
                      <span className="text-sm font-semibold" style={{ color: editColor || '#dcddde' }}>
                        {editName || selected.name}
                      </span>
                      <div className="text-xs text-fc-muted">Exemple de message</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Tab: Permissions */}
            {activeTab === 'perms' && (
              <div className="pr-1">
                {isAdmin && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-3 flex items-center gap-2">
                    <Shield size={16} className="text-red-400 flex-shrink-0" />
                    <div>
                      <div className="text-sm text-red-300 font-semibold">Permission Administrateur active</div>
                      <div className="text-xs text-red-400/70">Ce rôle a toutes les permissions automatiquement</div>
                    </div>
                  </div>
                )}
                {PERMISSION_GROUPS.map(group => (
                  <PermGroup
                    key={group.key}
                    group={group}
                    perms={editPerms}
                    onChange={setEditPerms}
                    disabled={isAdmin && group.key !== 'admin'}
                  />
                ))}
              </div>
            )}

            {/* Tab: Membres */}
            {activeTab === 'members' && (
              <RoleMembersTab serverId={serverId} roleId={selected.id} roleName={selected.name} />
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-fc-muted">
          <Shield size={40} className="opacity-20" />
          <div className="text-sm">Sélectionne un rôle pour le modifier</div>
          <div className="text-xs opacity-60">ou crée-en un nouveau à gauche</div>
        </div>
      )}
    </div>
  )
}

// Sous-composant : membres du rôle
function RoleMembersTab({ serverId, roleId, roleName }: { serverId: string; roleId: string; roleName: string }) {
  const { data: members = [] } = useQuery({
    queryKey: ['role-members', serverId, roleId],
    queryFn: () => api.get(`/servers/${serverId}/roles/${roleId}/members`).then(r => r.data).catch(() => []),
  })

  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-3">
        Membres avec le rôle {roleName} · {(members as any[]).length}
      </div>
      {!(members as any[]).length && (
        <p className="text-sm text-fc-muted">Aucun membre avec ce rôle.</p>
      )}
      {(members as any[]).map((m: any) => (
        <div key={m.id} className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-fc-hover/30 transition">
          {m.avatar
            ? <img src={m.avatar} loading="lazy" decoding="async" className="w-8 h-8 rounded-full" alt="" />
            : <div className="w-8 h-8 rounded-full bg-fc-accent flex items-center justify-center text-white text-xs font-bold">
                {m.username?.charAt(0)?.toUpperCase()}
              </div>
          }
          <div>
            <div className="text-sm text-white font-medium">{m.nick || m.username}</div>
            <div className="text-xs text-fc-muted">{m.username}#{m.discriminator}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
