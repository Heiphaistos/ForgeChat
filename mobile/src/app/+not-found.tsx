import { router, Stack } from 'expo-router'
import { View } from 'react-native'
import { Button, EmptyState } from '@/components/ui'
import { useT } from '@/i18n'
import { colors } from '@/theme'

export default function NotFound() {
  const t = useT()
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: t('social.notFound.title') }} />
      <EmptyState
        icon="help-circle-outline"
        title={t('social.notFound.body')}
        action={<Button title={t('social.notFound.home')} onPress={() => router.replace('/')} />}
      />
    </View>
  )
}
