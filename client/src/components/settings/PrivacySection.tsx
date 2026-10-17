import { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Toggle, Select, Field } from './shared'
import api from '../../api/client'
import { AUTO_ACTIVITY_KEY } from '../../hooks/useGameActivity'
import { askPasswordProof } from '../ui/PasswordPrompt'
import toast from 'react-hot-toast'
import { useT } from '../../i18n'

export default function PrivacySection() {
  const t = useT()
  const [autoActivity, setAutoActivity] = useState(() => { try { return localStorage.getItem(AUTO_ACTIVITY_KEY) !== 'false' } catch { return true } })
  const { data: settings, refetch } = useQuery({
    queryKey: ['user-settings'],
    queryFn: () => api.get('/user/settings').then(r => r.data),
    staleTime: 60_000,
  })

  const save = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.put('/user/settings', data),
    onSuccess: () => { toast.success(t('common.saved')); refetch() },
  })

  const [showOnline, setShowOnline] = useState(true)
  const [activityVisibility, setActivityVisibility] = useState('everyone')
  const [callVisibility, setCallVisibility] = useState('friends')
  const [friendRequestFrom, setFriendRequestFrom] = useState('everyone')
  const [dmFromAll, setDmFromAll] = useState(true)
  const [linkPreview, setLinkPreview] = useState(false)
  const [explicitFilter, setExplicitFilter] = useState('none')

  useEffect(() => {
    if (settings) {
      setShowOnline(settings.show_online ?? true)
      setActivityVisibility(settings.activity_visibility ?? 'everyone')
      setCallVisibility(settings.call_visibility ?? 'friends')
      setFriendRequestFrom(settings.friend_request_from ?? 'everyone')
      setDmFromAll(settings.dm_from_all ?? true)
      setLinkPreview(settings.link_preview === true)
      setExplicitFilter(settings.explicit_content_filter ?? 'none')
    }
  }, [settings])

  return (
    <div className="space-y-4">
      {[
        { label: t('settings.privacy.showOnline'), desc: t('settings.privacy.showOnlineDesc'), value: showOnline, onChange: setShowOnline },
        { label: t('settings.privacy.dmAll'), desc: t('settings.privacy.dmAllDesc'), value: dmFromAll, onChange: setDmFromAll },
        { label: t('settings.text.links'), desc: t('settings.text.linksDesc'), value: linkPreview, onChange: setLinkPreview },
      ].map(item => (
        <div key={item.label} className="flex items-center justify-between p-4 bg-fc-channel rounded-xl border border-fc-hover">
          <div>
            <div className="text-sm font-medium text-white">{item.label}</div>
            <div className="text-xs text-fc-muted">{item.desc}</div>
          </div>
          <Toggle value={item.value} onChange={item.onChange} label={item.label} />
        </div>
      ))}

      {'__TAURI_INTERNALS__' in window && (
        <div className="flex items-center justify-between p-4 bg-fc-channel rounded-xl border border-fc-hover">
          <div>
            <div className="text-sm font-medium text-white">{t('settings.privacy.game')}</div>
            <div className="text-xs text-fc-muted">{t('settings.privacy.gameDesc')}</div>
          </div>
          <Toggle value={autoActivity} onChange={v => { setAutoActivity(v); try { localStorage.setItem(AUTO_ACTIVITY_KEY, String(v)) } catch { /* réglage non mémorisé */ } }} label={t('settings.privacy.game')} />
        </div>
      )}

      <Field label={t('settings.privacy.activity')}>
        <Select value={activityVisibility} onChange={setActivityVisibility} className="w-full"
          options={[{ value: 'everyone', label: t('settings.privacy.everyone') }, { value: 'friends', label: t('settings.privacy.friendsOnly') }, { value: 'nobody', label: t('settings.privacy.nobody') }]} />
      </Field>

      <Field label={t('soc.privacy.call')}>
        <Select value={callVisibility} onChange={setCallVisibility} className="w-full"
          options={[{ value: 'everyone', label: t('settings.privacy.everyone') }, { value: 'friends', label: t('settings.privacy.friendsOnly') }, { value: 'nobody', label: t('settings.privacy.nobody') }]} />
      </Field>

      <Field label={t('settings.privacy.friendRequests')}>
        <Select value={friendRequestFrom} onChange={setFriendRequestFrom} className="w-full"
          options={[{ value: 'everyone', label: t('settings.privacy.everyone') }, { value: 'friends_of_friends', label: t('settings.privacy.friendsOfFriends') }, { value: 'nobody', label: t('settings.privacy.nobody') }]} />
      </Field>

      <Field label={t('settings.privacy.explicit')}>
        <Select value={explicitFilter} onChange={setExplicitFilter} className="w-full"
          options={[
            { value: 'none', label: t('settings.privacy.off') },
            { value: 'members_without_roles', label: t('settings.privacy.noRoles') },
            { value: 'all', label: t('settings.privacy.allMessages') },
          ]} />
      </Field>

      <button
        onClick={() => save.mutate({ show_online: showOnline, activity_visibility: activityVisibility, call_visibility: callVisibility, friend_request_from: friendRequestFrom, dm_from_all: dmFromAll, link_preview: linkPreview, explicit_content_filter: explicitFilter })}
        disabled={save.isPending}
        className="w-full py-2.5 bg-fc-accent hover:bg-fc-accent/80 text-white rounded-lg font-medium text-sm transition disabled:opacity-50"
      >
        {save.isPending ? t('common.saving') : t('common.save')}
      </button>

      <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover">
        <div className="text-sm font-medium text-white mb-1">{t('settings.privacy.export')}</div>
        <div className="text-xs text-fc-muted mb-3">{t('settings.privacy.exportDesc')}</div>
        <button
          onClick={async () => {
            const proof = await askPasswordProof(t('pwp.export'))
            if (!proof) return
            api.post('/users/me/data-export', proof, { responseType: 'blob' }).then(res => {
              const url = URL.createObjectURL(res.data)
              const a = document.createElement('a')
              a.href = url
              a.download = 'forgechat-mes-donnees.json'
              a.click()
              URL.revokeObjectURL(url)
            }).catch(() => toast.error(t('settings.privacy.exportError')))
          }}
          className="px-4 py-2 bg-fc-sidebar hover:bg-fc-hover text-white text-sm rounded-lg transition"
        >
          {t('settings.privacy.download')}
        </button>
      </div>
    </div>
  )
}
