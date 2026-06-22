import { useState, useCallback } from 'react'
import { X, Upload, Users, CheckCircle, AlertCircle } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { useDropzone } from 'react-dropzone'
import api from '../../api/client'
import toast from 'react-hot-toast'

interface ImportContactsModalProps {
  onClose: () => void
}

interface ParsedContact {
  email?: string
  username?: string
  raw: string
}

interface BulkResult {
  sent: number
  already_friends: number
  not_found: string[]
}

// ─── CSV parser (client-side) ─────────────────────────────────────────────────

function parseCsv(text: string): ParsedContact[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length === 0) return []

  // Detect header
  const header = lines[0].toLowerCase().split(/[,;]/).map(h => h.trim().replace(/^"|"$/g, ''))
  const emailIdx  = header.findIndex(h => h === 'email')
  const userIdx   = header.findIndex(h => ['username', 'user', 'pseudo', 'name'].includes(h))
  const hasHeader = emailIdx >= 0 || userIdx >= 0
  const dataLines = hasHeader ? lines.slice(1) : lines

  return dataLines
    .slice(0, 50)
    .map(line => {
      const cols = line.split(/[,;]/).map(c => c.trim().replace(/^"|"$/g, ''))
      const raw = line.trim()

      if (hasHeader) {
        const email    = emailIdx >= 0 && cols[emailIdx] ? cols[emailIdx] : undefined
        const username = userIdx  >= 0 && cols[userIdx]  ? cols[userIdx]  : undefined
        return { email, username, raw }
      }

      // No header: try to guess column by content
      const val = cols[0] || ''
      if (val.includes('@')) return { email: val, raw }
      return { username: val, raw }
    })
    .filter(c => c.email || c.username)
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ImportContactsModal({ onClose }: ImportContactsModalProps) {
  const [contacts, setContacts] = useState<ParsedContact[]>([])
  const [result, setResult] = useState<BulkResult | null>(null)
  const [fileName, setFileName] = useState('')

  const processFile = useCallback((file: File) => {
    setFileName(file.name)
    setResult(null)
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result as string
      const parsed = parseCsv(text)
      setContacts(parsed)
      if (parsed.length === 0) toast.error('Aucun contact trouvé dans le fichier')
    }
    reader.readAsText(file, 'utf-8')
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'text/csv': ['.csv'], 'text/plain': ['.txt'] },
    multiple: false,
    onDrop: (accepted) => { if (accepted[0]) processFile(accepted[0]) },
  })

  const sendInvites = useMutation({
    mutationFn: () => {
      const emails    = contacts.filter(c => c.email).map(c => c.email!)
      const usernames = contacts.filter(c => c.username).map(c => c.username!)
      return api.post('/friends/invite-bulk', { emails, usernames }).then(r => r.data as BulkResult)
    },
    onSuccess: (data) => {
      setResult(data)
      toast.success(`${data.sent} invitation(s) envoyée(s)`)
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const emailCount    = contacts.filter(c => c.email && !c.username).length
  const usernameCount = contacts.filter(c => c.username).length

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-fc-channel rounded-xl p-6 w-[480px] max-h-[80vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-fc-accent" />
            <h2 className="text-base font-bold text-white">Importer des contacts</h2>
          </div>
          <button
            onClick={onClose}
            className="text-fc-muted hover:text-white transition p-1 hover:bg-fc-hover rounded"
          >
            <X size={16} />
          </button>
        </div>

        {/* Drop zone */}
        <div
          {...getRootProps()}
          className={`rounded-lg border-2 border-dashed px-4 py-6 text-center cursor-pointer
            transition mb-4 flex-shrink-0
            ${isDragActive
              ? 'border-fc-accent bg-fc-accent/10 text-fc-accent'
              : 'border-fc-hover text-fc-muted hover:border-fc-accent/50 hover:text-white'}`}
        >
          <input {...getInputProps()} />
          <Upload size={22} className="mx-auto mb-2 opacity-70" />
          {fileName ? (
            <p className="text-sm font-medium text-white">{fileName}</p>
          ) : (
            <>
              <p className="text-sm font-medium">Glisser un fichier CSV ici</p>
              <p className="text-xs mt-1 opacity-60">ou cliquer pour parcourir (.csv, .txt)</p>
            </>
          )}
        </div>

        {/* Info format */}
        {contacts.length === 0 && (
          <div className="bg-fc-bg/50 rounded-lg px-3 py-2 text-xs text-fc-muted mb-4 flex-shrink-0">
            <p className="font-semibold text-white mb-1">Format attendu :</p>
            <p>CSV avec colonnes <code className="text-fc-accent">email</code> ou{' '}
              <code className="text-fc-accent">username</code> (ou les deux). Une valeur par ligne.</p>
            <p className="mt-1 opacity-70">Maximum 50 contacts par import.</p>
          </div>
        )}

        {/* Preview contacts */}
        {contacts.length > 0 && !result && (
          <>
            <div className="text-xs text-fc-muted mb-2 flex-shrink-0">
              <span className="text-white font-medium">{contacts.length}</span> contact(s) détecté(s)
              {usernameCount > 0 && ` · ${usernameCount} usernames`}
              {emailCount > 0 && ` · ${emailCount} emails (non envoyés)`}
            </div>
            <div className="overflow-y-auto flex-1 min-h-0 mb-4 rounded-lg border border-fc-hover divide-y divide-fc-hover/50">
              {contacts.slice(0, 50).map((c, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2">
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0
                    ${c.username ? 'bg-green-400' : 'bg-yellow-400'}`} />
                  <span className="text-xs text-fc-text flex-1 truncate">
                    {c.username ?? c.email}
                  </span>
                  <span className="text-xs text-fc-muted flex-shrink-0">
                    {c.username ? 'username' : 'email'}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Result */}
        {result && (
          <div className="flex-1 min-h-0 mb-4 space-y-2">
            <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">
              <CheckCircle size={14} className="text-green-400 flex-shrink-0" />
              <span className="text-sm text-white">
                <strong>{result.sent}</strong> invitation(s) envoyée(s)
              </span>
            </div>
            {result.already_friends > 0 && (
              <div className="flex items-center gap-2 bg-blue-500/10 border border-blue-500/30 rounded-lg px-3 py-2">
                <CheckCircle size={14} className="text-blue-400 flex-shrink-0" />
                <span className="text-sm text-fc-text">{result.already_friends} déjà ami(s)</span>
              </div>
            )}
            {result.not_found.length > 0 && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 mb-1">
                  <AlertCircle size={14} className="text-yellow-400 flex-shrink-0" />
                  <span className="text-sm text-fc-text">{result.not_found.length} non trouvé(s)</span>
                </div>
                <div className="text-xs text-fc-muted truncate">
                  {result.not_found.slice(0, 5).join(', ')}
                  {result.not_found.length > 5 ? ` + ${result.not_found.length - 5} autres` : ''}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 justify-end flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-fc-muted hover:text-white transition text-sm">
            {result ? 'Fermer' : 'Annuler'}
          </button>
          {!result && contacts.length > 0 && (
            <button
              onClick={() => sendInvites.mutate()}
              disabled={sendInvites.isPending || usernameCount === 0}
              className="px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded font-medium
                text-sm transition disabled:opacity-40 flex items-center gap-2"
            >
              {sendInvites.isPending ? 'Envoi...' : `Envoyer ${usernameCount} invitation(s)`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
