/**
 * Design tokens — alignés sur la palette sombre du client web ForgeChat.
 */
export const colors = {
  bg: '#313338',
  bgAlt: '#2b2d31',
  bgDeep: '#1e1f22',
  bgElevated: '#383a40',
  bgHover: '#404249',
  border: '#3f4147',
  primary: '#5865f2',
  primaryPressed: '#4752c4',
  text: '#f2f3f5',
  textSecondary: '#dbdee1',
  textMuted: '#949ba4',
  textFaint: '#6d6f78',
  danger: '#f23f43',
  success: '#23a55a',
  warning: '#f0b232',
  mention: 'rgba(250, 168, 26, 0.12)',
  link: '#00a8fc',
  codeBg: '#2b2d31',
  overlay: 'rgba(0,0,0,0.6)',
} as const

export const statusColors: Record<string, string> = {
  online: colors.success,
  idle: colors.warning,
  away: colors.warning,
  dnd: colors.danger,
  invisible: colors.textFaint,
  offline: colors.textFaint,
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const
export const radius = { sm: 6, md: 10, lg: 16, full: 999 } as const
export const font = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 26,
} as const
