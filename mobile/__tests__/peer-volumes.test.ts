// Volume par personne (salon, appel MP, appel de groupe) : bornes 0-200 %, mémorisation, application.
const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'x',
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockStore.delete(k)),
}))

import type { Room } from 'livekit-client'
import { applyPeerVolumes, clampVolume, peerVolume, usePeerVolumes, VOLUME_STEPS, withVolume } from '@/stores/peerVolumes'

describe('volume par personne', () => {
  it('paliers fins de 0 à 200 %', () => {
    expect(VOLUME_STEPS[0]).toBe(0)
    expect(VOLUME_STEPS[VOLUME_STEPS.length - 1]).toBe(2)
    expect(VOLUME_STEPS).toContain(1)
    expect(VOLUME_STEPS.length).toBe(9)
  })

  it('borne toute valeur à 0-2, 100 % si illisible', () => {
    expect(clampVolume(3)).toBe(2)
    expect(clampVolume(-1)).toBe(0)
    expect(clampVolume('1.5')).toBe(1.5)
    expect(clampVolume(undefined)).toBe(1)
    expect(clampVolume(NaN)).toBe(1)
  })

  it('100 % n’est pas stocké, les autres valeurs le sont, en nombre limité', () => {
    expect(withVolume({ a: 0.5 }, 'a', 1)).toEqual({})
    expect(withVolume({}, 'b', 1.75)).toEqual({ b: 1.75 })
    let v: Record<string, number> = {}
    for (let i = 0; i < 50; i++) v = withVolume(v, `u${i}`, 0.5)
    expect(Object.keys(v)).toHaveLength(40)
    expect(v.u49).toBe(0.5)
    expect(v.u0).toBeUndefined()
  })

  it('mémorise et applique le volume au participant (gain natif, > 100 % compris)', async () => {
    usePeerVolumes.getState().setVolume('alice', 2)
    expect(peerVolume('alice')).toBe(2)
    expect(peerVolume('bob')).toBe(1)
    await new Promise((r) => setTimeout(r, 0))
    expect(mockStore.get('fc.peerVolumes.v1')).toContain('"alice":2')
    const alice = { identity: 'alice', setVolume: jest.fn() }
    const bob = { identity: 'bob', setVolume: jest.fn() }
    applyPeerVolumes({ remoteParticipants: new Map([['alice', alice], ['bob', bob]]) } as unknown as Room)
    expect(alice.setVolume).toHaveBeenCalledWith(2)
    expect(bob.setVolume).toHaveBeenCalledWith(1)
  })

  it('rendu muet pour moi : 0 appliqué, volume réglé conservé', () => {
    usePeerVolumes.getState().setVolume('m', 1.5)
    usePeerVolumes.getState().setMuted('m', true)
    expect(peerVolume('m')).toBe(0)
    usePeerVolumes.getState().setMuted('m', false)
    expect(peerVolume('m')).toBe(1.5)
  })
})
