import type { ConfigPlugin } from '@expo/config-plugins'

declare const withScreenShare: ConfigPlugin & {
  PERMISSIONS: string[]
}
export = withScreenShare
