// Tests : interface en français (langue de référence), quelle que soit la langue de la machine.
import { useLang } from '@/i18n'

// Les tests qui appellent jest.resetModules() recréent le store de langue : il relit alors la locale du
// système. On la fixe au niveau d'Intl (global, donc conservé d'un reset à l'autre).
const resolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions
Intl.DateTimeFormat.prototype.resolvedOptions = function (this: Intl.DateTimeFormat) {
  return { ...resolvedOptions.call(this), locale: 'fr-FR' }
}

useLang.setState({ lang: 'fr' })
