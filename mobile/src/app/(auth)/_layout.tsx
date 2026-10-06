import { Stack } from 'expo-router'
import { colors } from '@/theme'

export const unstable_settings = { initialRouteName: 'login' }

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bgDeep }, animation: 'fade' }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
    </Stack>
  )
}
