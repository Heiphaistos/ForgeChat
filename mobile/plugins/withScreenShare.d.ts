import type { ConfigPlugin } from '@expo/config-plugins'

declare const withScreenShare: ConfigPlugin & {
  enableMediaProjectionService(src: string): string
  PERMISSIONS: string[]
}
export = withScreenShare
