import { useState, useMemo } from 'react'
import { Plus, Trash2, Save, Shield, ChevronDown, ChevronRight, ChevronUp } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api, { mediaUrl } from '../../api/client'
import toast from 'react-hot-toast'

// Utilise des puissances de 2 comme nombres JS (safe jusqu'à 2**52 avec Number)
const B = (n: number) => Math.pow(2, n)

// Mêmes bits que le serveur (server/src/models/role.rs::Permissions) : ce sont
// les seuls que le serveur applique. L'ancienne liste (50+ droits, numérotés
// comme Discord) enregistrait des bits que le serveur lisait autrement :
// « Administrateur » cochait en réalité « Voir le salon ».
const PERMISSION_GROUPS = [
  {
    key: 'admin',
    label: 'Administration',
    color: 'text-red-400',
    perms: [
      { key: 'ADMINISTRATOR',    bit: B(31), label: 'Administrateur',        desc: 'Toutes les permissions, ignore les restrictions des salons' },
      { key: 'MANAGE_SERVER',    bit: B(8),  label: 'Gérer le serveur',      desc: 'Modifier le nom, l\'icône et les paramètres du serveur' },
      { key: 'MANAGE_ROLES',     bit: B(5),  label: 'Gérer les rôles',       desc: 'Créer, modifier, supprimer et attribuer des rôles' },
      { key: 'MANAGE_CHANNELS',  bit: B(4),  label: 'Gérer les salons',      desc: 'Créer, modifier et supprimer des salons (vaut les quatre droits ci-dessous, sauf les salons du propriétaire)' },
      { key: 'CREATE_CHANNELS',  bit: B(19), label: 'Créer des salons',      desc: 'Créer des salons et des catégories' },
      { key: 'EDIT_CHANNELS',    bit: B(20), label: 'Modifier les salons',   desc: 'Nom, sujet, réglages, ordre, archivage, permissions, tags, flux RSS, webhook GitHub' },
      { key: 'DELETE_CHANNELS',  bit: B(21), label: 'Supprimer tous les salons', desc: 'Supprimer n’importe quel salon ou catégorie, sauf ceux créés par le propriétaire' },
      { key: 'DELETE_OWN_CHANNELS', bit: B(22), label: 'Supprimer ses propres salons', desc: 'Supprimer uniquement les salons et catégories qu’on a créés' },
    ]
  },
  {
    key: 'members',
    label: 'Gestion des membres',
    color: 'text-orange-400',
    perms: [
      { key: 'KICK_MEMBERS',     bit: B(6),  label: 'Expulser des membres',  desc: 'Expulser des membres du serveur' },
      { key: 'BAN_MEMBERS',      bit: B(7),  label: 'Bannir définitivement', desc: 'Bannir définitivement ou temporairement, lever tout bannissement' },
      { key: 'BAN_TEMP',         bit: B(23), label: 'Bannir temporairement', desc: 'Bannir pour une durée limitée et lever les bannissements temporaires' },
    ]
  },
  {
    key: 'channels',
    label: 'Salons texte',
    color: 'text-blue-400',
    perms: [
      { key: 'VIEW_CHANNEL',     bit: B(0),  label: 'Voir les salons',       desc: 'Voir les salons et leur contenu' },
      { key: 'READ_HISTORY',     bit: B(2),  label: 'Lire l\'historique',    desc: 'Voir les messages précédents dans un salon' },
      { key: 'SEND_MESSAGES',    bit: B(1),  label: 'Envoyer des messages',  desc: 'Écrire des messages dans les salons texte' },
      { key: 'MANAGE_MESSAGES',  bit: B(3),  label: 'Gérer les messages',    desc: 'Supprimer et épingler les messages des autres' },
      { key: 'MENTION_EVERYONE', bit: B(9),  label: 'Mentionner @everyone',  desc: 'Mentionner @everyone et @here' },
      { key: 'ATTACH_FILES',     bit: B(10), label: 'Joindre des fichiers',  desc: 'Envoyer des fichiers et images' },
      { key: 'EMBED_LINKS',      bit: B(11), label: 'Intégrer des liens',    desc: 'Générer des aperçus de liens' },
      { key: 'ADD_REACTIONS',    bit: B(12), label: 'Ajouter des réactions', desc: 'Réagir aux messages avec des emojis' },
    ]
  },
  {
    key: 'voice',
    label: 'Vocal & Vidéo',
    color: 'text-green-400',
    perms: [
      { key: 'CONNECT_VOICE',    bit: B(13), label: 'Rejoindre la voix',     desc: 'Accéder aux salons vocaux' },
      { key: 'SPEAK_VOICE',      bit: B(14), label: 'Parler',                desc: 'Parler dans les salons vocaux' },
      { key: 'STREAM',           bit: B(40), label: 'Partager l\'écran / Go Live', desc: 'Partager son écran ou sa caméra' },
      { key: 'PRIORITY_SPEAKER', bit: B(18), label: 'Orateur prioritaire',   desc: 'Voix amplifiée, autres atténuées' },
      { key: 'MUTE_MEMBERS',     bit: B(15), label: 'Rendre muet',           desc: 'Couper le micro des autres en vocal' },
      { key: 'DEAFEN_MEMBERS',   bit: B(16), label: 'Rendre sourd',          desc: 'Couper le son des autres en vocal' },
      { key: 'MOVE_MEMBERS',     bit: B(17), label: 'Déplacer des membres',  desc: 'Déplacer des membres entre salons vocaux' },
    ]
  },
]

// Flatten pour usage
const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap(g => g.perms)
const ADMIN_BIT = B(31)

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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

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

  // Plus haut en premier ; @everyone reste toujours en bas (position 0) et ne bouge pas.
  const sortedRoles = useMemo(() => [...roles].sort((a, b) => b.position - a.position), [roles])
  const orderable = useMemo(() => sortedRoles.filter(r => !r.is_everyone), [sortedRoles])

  // Le serveur refuse de déplacer un rôle au niveau de votre rôle le plus haut ou au-dessus.
  const reorder = useMutation({
    mutationFn: (roleIds: string[]) => api.patch(`/servers/${serverId}/roles/order`, { role_ids: roleIds }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['roles', serverId] }),
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })
  const move = (idx: number, delta: number) => {
    const ids = orderable.map(r => r.id)
    const j = idx + delta
    if (j < 0 || j >= ids.length) return
    ;[ids[idx], ids[j]] = [ids[j], ids[idx]]
    reorder.mutate(ids)
  }

  const isAdmin = hasBit(editPerms, ADMIN_BIT)

  const totalEnabled = useMemo(
    () => ALL_PERMISSIONS.filter(p => hasBit(editPerms, p.bit)).length,
    [editPerms]
  )

  return (
    <div className="flex gap-4 h-full min-h-0">
      {/* Liste rôles */}
      <div className="w-52 flex-shrink-0 flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            value={newName} onChange={e => setNewName(e.target.value)}
            placeholder="Nouveau rôle"
            enterKeyHint="done" autoCapitalize="words"
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
        <div className="flex-1 overflow-y-auto overscroll-contain space-y-0.5">
          {sortedRoles.map(r => {
            const idx = orderable.findIndex(o => o.id === r.id)
            return (
            <div key={r.id} className="flex items-center gap-0.5 group">
              <button onClick={() => selectRole(r)}
                className={`flex-1 min-w-0 text-left px-2.5 py-2 rounded-lg text-sm flex items-center gap-2 transition
                  ${selected?.id === r.id ? 'bg-fc-accent/20 text-white' : 'text-fc-muted hover:text-white hover:bg-fc-hover/50'}`}
              >
                <div className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: r.color ? colorIntToHex(r.color) : '#99aab5' }} />
                <span className="truncate flex-1">{r.name}</span>
                {r.hoisted && <span className="text-[9px] text-fc-muted/60 group-hover:text-fc-muted">H</span>}
                {r.mentionable && <span className="text-[9px] text-fc-muted/60 group-hover:text-fc-muted">@</span>}
              </button>
              {idx >= 0 && (
                <div className="flex flex-col">
                  <button onClick={() => move(idx, -1)} disabled={idx === 0 || reorder.isPending}
                    className="p-0.5 text-fc-muted hover:text-white disabled:opacity-20" title="Monter" aria-label={`Monter ${r.name}`}>
                    <ChevronUp size={12} />
                  </button>
                  <button onClick={() => move(idx, 1)} disabled={idx === orderable.length - 1 || reorder.isPending}
                    className="p-0.5 text-fc-muted hover:text-white disabled:opacity-20" title="Descendre" aria-label={`Descendre ${r.name}`}>
                    <ChevronDown size={12} />
                  </button>
                </div>
              )}
            </div>
            )
          })}
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
                <>
                  <button onClick={() => setShowDeleteConfirm(true)}
                    className="p-1.5 text-fc-muted hover:text-red-400 hover:bg-red-500/10 rounded-lg transition" title="Supprimer le rôle">
                    <Trash2 size={14} />
                  </button>
                  {showDeleteConfirm && (
                    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 px-4" onClick={() => setShowDeleteConfirm(false)}>
                      <div className="bg-fc-sidebar rounded-xl shadow-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
                        <h3 className="text-lg font-bold text-white mb-2">Supprimer « {selected.name} »</h3>
                        <p className="text-sm text-fc-muted mb-5">Ce rôle sera retiré de tous les membres. Cette action est irréversible.</p>
                        <div className="flex gap-3 justify-end">
                          <button onClick={() => setShowDeleteConfirm(false)} className="px-4 py-2 text-sm rounded-lg bg-fc-hover hover:bg-fc-input text-white transition">Annuler</button>
                          <button onClick={() => { deleteRole.mutate(selected.id); setShowDeleteConfirm(false) }} disabled={deleteRole.isPending} className="px-4 py-2 text-sm rounded-lg bg-red-500 hover:bg-red-600 text-white font-semibold transition disabled:opacity-50">Supprimer</button>
                        </div>
                      </div>
                    </div>
                  )}
                </>
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

          <div className="flex-1 overflow-y-auto overscroll-contain">
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
                      <button type="button" onClick={() => setEditHoisted(v => !v)}
                        role="switch" aria-checked={editHoisted}
                        className={`w-11 h-6 rounded-full relative transition flex-shrink-0 ml-4 cursor-pointer focus:outline-none focus:ring-2 focus:ring-fc-accent ${editHoisted ? 'bg-fc-accent' : 'bg-fc-hover'}`}>
                        <div className={`w-[18px] h-[18px] bg-white rounded-full absolute top-[3px] transition-all shadow ${editHoisted ? 'left-[23px]' : 'left-[3px]'}`} />
                      </button>
                    </label>
                    <label className="flex items-center justify-between px-4 py-3 bg-fc-channel rounded-xl cursor-pointer hover:bg-fc-hover/40 transition select-none">
                      <div>
                        <div className="text-sm text-white font-medium">Permettre @mention du rôle</div>
                        <div className="text-xs text-fc-muted">Tout le monde peut mentionner ce rôle pour notifier ses membres</div>
                      </div>
                      <button type="button" onClick={() => setEditMentionable(v => !v)}
                        role="switch" aria-checked={editMentionable}
                        className={`w-11 h-6 rounded-full relative transition flex-shrink-0 ml-4 cursor-pointer focus:outline-none focus:ring-2 focus:ring-fc-accent ${editMentionable ? 'bg-fc-accent' : 'bg-fc-hover'}`}>
                        <div className={`w-[18px] h-[18px] bg-white rounded-full absolute top-[3px] transition-all shadow ${editMentionable ? 'left-[23px]' : 'left-[3px]'}`} />
                      </button>
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
            ? <img src={mediaUrl(m.avatar)} loading="lazy" decoding="async" className="w-8 h-8 rounded-full" alt="" />
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
