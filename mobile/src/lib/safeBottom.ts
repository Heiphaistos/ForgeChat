import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller'
import { useAnimatedStyle } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { bottomPadding } from './bottomPadding'

/** Style animé `paddingBottom` pour une barre du bas au-dessus du clavier et de la navigation. */
export function useKeyboardSafeBottom(base = 0) {
  const { bottom } = useSafeAreaInsets()
  const { progress } = useReanimatedKeyboardAnimation()
  return useAnimatedStyle(() => ({ paddingBottom: bottomPadding(bottom, progress.value, base) }))
}
