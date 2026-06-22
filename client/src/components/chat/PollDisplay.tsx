import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { BarChart2, Clock, CheckCircle2, Loader2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'
import api from '../../api/client'
import toast from 'react-hot-toast'

interface PollOption {
  id: string
  text: string
  votes: number
}

interface Poll {
  id: string
  question: string
  options: PollOption[]
  total_votes: number
  expires_at: string | null
  user_vote_id: string | null
}

interface Props {
  pollId: string
  serverId: string
  channelId: string
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="h-1.5 w-full bg-fc-hover rounded-full overflow-hidden">
      <div
        className="h-full bg-fc-accent rounded-full transition-all duration-500"
        style={{ width: `${Math.max(percent, percent > 0 ? 2 : 0)}%` }}
      />
    </div>
  )
}

export default function PollDisplay({ pollId, serverId, channelId }: Props) {
  const queryClient = useQueryClient()
  const [pendingOptionId, setPendingOptionId] = useState<string | null>(null)

  const { data: poll, isLoading, isError } = useQuery<Poll>({
    queryKey: ['poll', pollId],
    queryFn: () =>
      api
        .get(`/servers/${serverId}/channels/${channelId}/polls/${pollId}`)
        .then(r => r.data),
    staleTime: 30_000,
    retry: false,
  })

  const voteMutation = useMutation({
    mutationFn: (optionId: string) =>
      api.post(
        `/servers/${serverId}/channels/${channelId}/polls/${pollId}/vote`,
        { option_id: optionId }
      ),
    onMutate: (optionId) => {
      setPendingOptionId(optionId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['poll', pollId] })
    },
    onError: (e: any) => {
      toast.error(e.response?.data?.error ?? 'Erreur lors du vote')
    },
    onSettled: () => {
      setPendingOptionId(null)
    },
  })

  if (isLoading) {
    return (
      <div className="mt-2 flex items-center gap-2 text-xs text-fc-muted border border-fc-hover rounded-lg p-3 max-w-sm">
        <Loader2 size={14} className="animate-spin" />
        <span>Chargement du sondage...</span>
      </div>
    )
  }

  if (isError || !poll) return null

  const isExpired = poll.expires_at ? new Date(poll.expires_at) < new Date() : false
  const hasVoted = !!poll.user_vote_id
  const canVote = !hasVoted && !isExpired

  return (
    <div className="mt-2 bg-fc-channel border border-fc-hover rounded-lg p-3 max-w-sm">
      {/* Header */}
      <div className="flex items-start gap-2 mb-3">
        <div className="p-1 rounded bg-fc-accent/10 flex-shrink-0 mt-0.5">
          <BarChart2 size={13} className="text-fc-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white leading-snug">{poll.question}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-fc-muted">
              {poll.total_votes} vote{poll.total_votes !== 1 ? 's' : ''}
            </span>
            {poll.expires_at && (
              <span className={`flex items-center gap-1 text-xs ${isExpired ? 'text-red-400' : 'text-fc-muted'}`}>
                <Clock size={10} />
                {isExpired
                  ? 'Terminé'
                  : `Se termine ${formatDistanceToNow(new Date(poll.expires_at), { addSuffix: true, locale: fr })}`}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Options */}
      <div className="space-y-2">
        {poll.options.map(option => {
          const percent = poll.total_votes > 0
            ? Math.round((option.votes / poll.total_votes) * 100)
            : 0
          const isMyVote = poll.user_vote_id === option.id
          const isPending = pendingOptionId === option.id

          return (
            <div key={option.id} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                {canVote ? (
                  <button
                    onClick={() => voteMutation.mutate(option.id)}
                    disabled={voteMutation.isPending}
                    className={`flex-1 text-left text-sm px-2 py-1 rounded transition
                      ${isPending
                        ? 'text-fc-accent'
                        : 'text-fc-text hover:text-white hover:bg-fc-hover/50'}
                      disabled:opacity-60`}
                  >
                    {isPending ? (
                      <span className="flex items-center gap-1.5">
                        <Loader2 size={11} className="animate-spin" />
                        {option.text}
                      </span>
                    ) : (
                      option.text
                    )}
                  </button>
                ) : (
                  <div className="flex-1 flex items-center gap-1.5 text-sm px-2 py-1">
                    {isMyVote && (
                      <CheckCircle2 size={13} className="text-fc-accent flex-shrink-0" />
                    )}
                    <span className={isMyVote ? 'text-white font-medium' : 'text-fc-text'}>
                      {option.text}
                    </span>
                  </div>
                )}
                {(hasVoted || isExpired) && (
                  <div className="flex items-center gap-1.5 flex-shrink-0 text-xs text-fc-muted min-w-[3.5rem] text-right">
                    <span className={isMyVote ? 'text-fc-accent font-semibold' : ''}>
                      {percent}%
                    </span>
                    <span className="text-fc-muted/60">({option.votes})</span>
                  </div>
                )}
              </div>
              {(hasVoted || isExpired) && <ProgressBar percent={percent} />}
            </div>
          )
        })}
      </div>

      {/* Footer état */}
      {isExpired && (
        <p className="text-xs text-red-400/80 mt-2 text-center">Ce sondage est terminé.</p>
      )}
      {hasVoted && !isExpired && (
        <p className="text-xs text-fc-muted mt-2 text-center">Vous avez déjà voté.</p>
      )}
    </div>
  )
}
