import { t } from '@/i18n'
import { router } from 'expo-router'
import { Alert } from 'react-native'
import { dmsApi } from '@/api/dms'
import { ApiError, errorMessage } from '@/lib/http'

/** `support` : déplie d'office le menu « Support à distance » du MP (profil, appel, salon vocal). */
export async function openDmWith(userId: string, username: string, support = false) {
  try {
    const { dm_id } = await dmsApi.open(userId)
    router.push({ pathname: '/dm/[dmId]', params: { dmId: dm_id, name: username, userId, ...(support ? { support: '1' } : {}) } })
  } catch (e) {
    Alert.alert(
      t('sw.dm.openFail'),
      e instanceof ApiError && e.status === 403 ? t('sw.dm.noDms', { name: username }) : errorMessage(e),
    )
  }
}
