import { unreadLabel } from '@/lib/format'

describe('unreadLabel', () => {
  it('accorde au singulier et au pluriel', () => {
    expect(unreadLabel(1)).toBe('1 non lu')
    expect(unreadLabel(2)).toBe('2 non lus')
    expect(unreadLabel(42)).toBe('42 non lus')
  })
})
