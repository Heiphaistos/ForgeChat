import { router, Stack } from 'expo-router'
import { View } from 'react-native'
import { Button, EmptyState } from '@/components/ui'
import { colors } from '@/theme'

export default function NotFound() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: 'Introuvable' }} />
      <EmptyState
        icon="help-circle-outline"
        title="Cette page n’existe pas"
        action={<Button title="Retour à l’accueil" onPress={() => router.replace('/')} />}
      />
    </View>
  )
}
