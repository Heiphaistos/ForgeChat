import {
  extractResetToken,
  formatCallDuration,
  formatSecret,
  isHHMM,
  needsVerification,
  toHHMM,
  usernameError,
} from '@/features/account/rules'

const TOKEN = 'a'.repeat(32) + 'B9'.repeat(16)

describe('extractResetToken', () => {
  it('lit le jeton du lien du mail (fragment ou query) ou le jeton seul', () => {
    expect(extractResetToken(`https://forgechat.example/reset-password#token=${TOKEN}`)).toBe(TOKEN)
    expect(extractResetToken(`https://forgechat.example/reset-password?token=${TOKEN}`)).toBe(TOKEN)
    expect(extractResetToken(`  ${TOKEN}  `)).toBe(TOKEN)
  })
  it('refuse les jetons mal formés', () => {
    expect(extractResetToken('')).toBeNull()
    expect(extractResetToken(null)).toBeNull()
    expect(extractResetToken(`#token=${TOKEN.slice(1)}`)).toBeNull()
    expect(extractResetToken(`#token=${TOKEN}x`)).toBeNull()
    expect(extractResetToken(`#token=${TOKEN.slice(2)}-_`)).toBeNull()
  })
})

describe('usernameError', () => {
  it('suit les règles du serveur', () => {
    expect(usernameError('élodie_42')).toBeNull()
    expect(usernameError('a')).not.toBeNull()
    expect(usernameError('x'.repeat(33))).not.toBeNull()
    expect(usernameError('avec espace')).not.toBeNull()
    expect(usernameError('<script>')).not.toBeNull()
  })
})

describe('heures calmes', () => {
  it('valide HH:MM et convertit le TIME Postgres', () => {
    expect(isHHMM('22:00')).toBe(true)
    expect(isHHMM('7:00')).toBe(false)
    expect(isHHMM('24:00')).toBe(false)
    expect(toHHMM('22:30:00', '08:00')).toBe('22:30')
    expect(toHHMM(null, '08:00')).toBe('08:00')
  })
})

describe('formats', () => {
  it('groupe la clé TOTP par 4', () => {
    expect(formatSecret('ABCDEFGHIJ')).toBe('ABCD EFGH IJ')
  })
  it('affiche la durée des appels', () => {
    expect(formatCallDuration(null)).toBe('')
    expect(formatCallDuration(0)).toBe('')
    expect(formatCallDuration(45)).toBe('45 s')
    expect(formatCallDuration(185)).toBe('3 min 05 s')
    expect(formatCallDuration(3720)).toBe('1 h 02 min')
  })
})

describe('needsVerification', () => {
  const server = { verification_enabled: true }
  it('exige la vérification seulement si activée et pas encore faite', () => {
    expect(needsVerification({ server, member: { verified_at: null } })).toBe(true)
    expect(needsVerification({ server, member: { verified_at: '2026-01-01T00:00:00Z' } })).toBe(false)
    expect(needsVerification({ server: { verification_enabled: false }, member: { verified_at: null } })).toBe(false)
  })
  it('ne bloque pas sans données (chargement, ancien serveur)', () => {
    expect(needsVerification(undefined)).toBe(false)
    expect(needsVerification({ server })).toBe(false)
  })
})
