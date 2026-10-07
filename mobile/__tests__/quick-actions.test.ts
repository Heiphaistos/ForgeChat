import { actionFromIdentifier, refFromNotificationData, REACTION_ACTIONS, REPLY_ACTION } from '@/features/notifications/quickActions'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

describe('actions des notifications de message', () => {
  it('répondre, réagir, rien d’autre', () => {
    expect(actionFromIdentifier(REPLY_ACTION)).toEqual({ kind: 'reply' })
    expect(actionFromIdentifier(REACTION_ACTIONS[0].id)).toEqual({ kind: 'react', emoji: '👍' })
    expect(actionFromIdentifier(REACTION_ACTIONS[1].id)).toEqual({ kind: 'react', emoji: '❤️' })
    expect(actionFromIdentifier('expo.modules.notifications.actions.DEFAULT')).toBeNull()
    expect(actionFromIdentifier('react_x')).toBeNull()
  })

  it('conversation revalidée depuis les données (push serveur ou locale)', () => {
    expect(refFromNotificationData({ kind: 'dm', dm_id: A.toUpperCase() })).toEqual({ kind: 'dm', dmId: A })
    expect(refFromNotificationData({ kind: 'group', group_id: A })).toEqual({ kind: 'group', groupId: A })
    expect(refFromNotificationData({ kind: 'channel', server_id: A, channel_id: B, message_id: B })).toEqual({ kind: 'channel', serverId: A, channelId: B })
    expect(refFromNotificationData({ kind: 'channel', channel_id: B })).toBeNull()
    expect(refFromNotificationData({ kind: 'dm', dm_id: '../../etc' })).toBeNull()
    expect(refFromNotificationData({ kind: 'call', from: A })).toBeNull()
  })
})
