import { Stack } from 'expo-router'
import { colors } from '@/theme'

export const unstable_settings = { initialRouteName: 'login' }

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'fade' }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
      <Stack.Screen name="verify-email" />
    </Stack>
  )
}
