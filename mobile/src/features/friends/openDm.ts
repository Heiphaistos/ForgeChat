import { router } from 'expo-router'
import { Alert } from 'react-native'
import { dmsApi } from '@/api/dms'
import { ApiError, errorMessage } from '@/lib/http'

export async function openDmWith(userId: string, username: string) {
  try {
    const { dm_id } = await dmsApi.open(userId)
    router.push({ pathname: '/dm/[dmId]', params: { dmId: dm_id, name: username, userId } })
  } catch (e) {
    Alert.alert(
      'Impossible d’ouvrir la conversation',
      e instanceof ApiError && e.status === 403 ? `${username} n’accepte pas les messages privés de ta part.` : errorMessage(e),
    )
  }
}
