/** channels.rs::set_waiting_room ne s'applique qu'aux salons vocaux et scènes (pas aux salons vidéo). */
export const supportsWaitingRoom = (type: string) => type === 'voice' || type === 'stage'

/**
 * Nouvel état à envoyer à PUT .../waiting-room, ou null s'il n'y a rien à faire (type non géré,
 * réglage inchangé) : comme la condition de ChannelSettingsModal du web.
 */
export const waitingRoomChange = (type: string, current: boolean | undefined, wanted: boolean): boolean | null =>
  supportsWaitingRoom(type) && wanted !== !!current ? wanted : null
