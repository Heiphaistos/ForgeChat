import { AttachmentUploadError, restoreAfterSendError } from '@/features/chat/sendErrors'

const sent = { text: 'Bonjour', files: ['a.png'] }
const empty = { text: '', files: [] as string[] }

describe('restoreAfterSendError', () => {
  it('échec avant le serveur : remet le texte et les fichiers', () => {
    expect(restoreAfterSendError(new Error('Réseau indisponible'), sent, empty)).toEqual({ text: 'Bonjour', files: ['a.png'] })
  })

  it('échec du seul upload : remet les fichiers, pas le texte déjà envoyé', () => {
    expect(restoreAfterSendError(new AttachmentUploadError('x'), sent, empty)).toEqual({ text: '', files: ['a.png'] })
  })

  it('n’écrase pas ce qui a été retapé entre-temps', () => {
    const current = { text: 'nouveau brouillon', files: ['b.pdf'] }
    expect(restoreAfterSendError(new Error('x'), sent, current)).toEqual(current)
  })
})
