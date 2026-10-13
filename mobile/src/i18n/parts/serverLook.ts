// Bannières entières et apparence des serveurs (préfixe srvLook.).
// fr = référence, en = traduction (une clé absente retombe sur le français).
export const fr = {
  'srvLook.cropBanner': 'Recadrer une nouvelle bannière',
  'srvLook.bannerHint': 'Par défaut, l’image est gardée entière (PNG, JPG, GIF ou WEBP, animations gardées, 10 Mo max) et affichée sans être rognée.',
}

export const en: Partial<Record<keyof typeof fr, string>> = {
  'srvLook.cropBanner': 'Crop a new banner',
  'srvLook.bannerHint': 'By default the whole image is kept (PNG, JPG, GIF or WEBP, animation kept, 10 MB max) and shown without cropping.',
}
