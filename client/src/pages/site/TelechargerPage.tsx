import { useState, type ReactNode } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { Apple, Download, Globe, Monitor, RefreshCw, ShieldCheck, Smartphone, Terminal, Copy, Check } from 'lucide-react'
import SiteLayout from './SiteLayout'
import { Phone } from './Cinema'
import {
  ALTSTORE_SOURCE, artefactUrl, dateFr, plateformeDuVisiteur, taille, useDesktopRelease, useMobileRelease,
  type Artefact, type Plateforme, type Release,
} from './releases'

const PLATEFORMES: { id: Plateforme; nom: string; icone: ReactNode; resume: string }[] = [
  { id: 'windows', nom: 'Windows', icone: <Monitor size={22} />, resume: 'Windows 10 et 11 · installeur ou portable' },
  { id: 'macos', nom: 'macOS', icone: <Apple size={22} />, resume: 'macOS 11 et plus · Apple Silicon et Intel' },
  { id: 'linux', nom: 'Linux', icone: <Terminal size={22} />, resume: '.deb, .rpm, Arch / Omarchy ou AppImage' },
  { id: 'android', nom: 'Android', icone: <Smartphone size={22} />, resume: 'Android 7 et plus · APK signé' },
  { id: 'iphone', nom: 'iPhone et iPad', icone: <Apple size={22} />, resume: 'Web app ou app native, sans App Store' },
  { id: 'web', nom: 'Navigateur', icone: <Globe size={22} />, resume: 'Rien à installer' },
]

function Copier({ texte }: { texte: string }) {
  const [ok, setOk] = useState(false)
  return (
    <span className="site-code">
      <span>{texte}</span>
      <button
        type="button"
        className="site-btn site-btn-ghost"
        style={{ padding: '6px 10px' }}
        onClick={() => navigator.clipboard?.writeText(texte).then(() => { setOk(true); setTimeout(() => setOk(false), 1500) })}
        aria-label="Copier"
      >
        {ok ? <Check size={16} /> : <Copy size={16} />}
      </button>
    </span>
  )
}

function Bouton({ a, titre, sous, primaire }: { a?: Artefact; titre: string; sous: string; primaire?: boolean }) {
  if (!a) return <span className="site-btn site-btn-ghost" aria-disabled="true">{titre}<small>bientôt disponible</small></span>
  return (
    <a href={artefactUrl(a)} download className={`site-btn ${primaire ? 'site-btn-primary' : 'site-btn-ghost'}`}>
      <Download size={18} />
      <span>{titre}<small>{[sous, taille(a)].filter(Boolean).join(' · ')}</small></span>
    </a>
  )
}

function Empreinte({ a }: { a?: Artefact }) {
  if (!a?.sha256) return null
  return <p className="site-muted" style={{ fontSize: '.8rem', wordBreak: 'break-all' }}>SHA-256 : {a.sha256}</p>
}

function MisesAJour({ children }: { children: ReactNode }) {
  return (
    <section className="site-section reveal">
      <div className="site-card">
        <div className="ico"><RefreshCw size={22} /></div>
        <h2 className="site-h3">Mises à jour automatiques</h2>
        <div className="site-muted">{children}</div>
      </div>
    </section>
  )
}

type Os = 'windows' | 'macos' | 'linux' | 'mobile' | 'web'

/** Fenêtre de bureau aux couleurs du système (boutons Windows, feux macOS, barre GNOME). */
function Fenetre({ os }: { os: Os }) {
  return (
    <div className={`dl-win dl-win-${os}`} aria-hidden="true">
      <div className="dl-win-bar">
        {os === 'macos' ? <span className="dl-feux"><i /><i /><i /></span> : null}
        <span className="dl-win-titre">ForgeChat</span>
        {os !== 'macos' ? <span className="dl-win-btn"><i /><i /><i /></span> : null}
      </div>
      <div className="dl-win-body">
        <div className="dl-win-rail"><b /><b /><b /></div>
        <div className="dl-win-chat">
          {['70%', '52%', '84%', '40%'].map((w, i) => <span key={i} className="dl-win-line" style={{ width: w, '--i': i } as React.CSSProperties} />)}
          <span className="dl-win-input" />
        </div>
      </div>
    </div>
  )
}

function EnTete({ titre, release, os, children }: { titre: string; release: Release | null; os: Os; children: ReactNode }) {
  const date = dateFr(release?.pub_date)
  return (
    <section className="site-hero">
      <div className="site-wrap dl-hero">
        <div>
          <Link to="/telecharger" className="site-eyebrow">← Toutes les plateformes</Link>
          <h1 className="site-h1 reveal">ForgeChat pour <span className="grad">{titre}</span></h1>
          {release && <p className="site-muted reveal">Version {release.version}{date ? ` · publiée le ${date}` : ''}</p>}
          <div className="site-actions reveal">{children}</div>
        </div>
        <div className="dl-visuel">{os === 'mobile' ? <Phone className="dl-phone" /> : <Fenetre os={os} />}</div>
      </div>
    </section>
  )
}

function Etapes({ children }: { children: ReactNode }) {
  return <ol className="site-steps">{children}</ol>
}
function Etape({ titre, children }: { titre: string; children?: ReactNode }) {
  return <li className="reveal"><h3 className="site-h3">{titre}</h3>{children}</li>
}

// ─────────────────────────────── Pages par plateforme ───────────────────────────────

function Windows() {
  const r = useDesktopRelease()
  const setup = r?.platforms['windows-x86_64']
  return (
    <>
      <EnTete titre="Windows" os="windows" release={r}>
        <Bouton a={setup} titre="Installeur" sous="recommandé" primaire />
        <Bouton a={r?.platforms['windows-portable']} titre="Version portable" sous="sans installation" />
      </EnTete>
      <div className="site-wrap">
        <Empreinte a={setup} />
        <h2 className="site-h2 reveal">Installer pas à pas</h2>
        <Etapes>
          <Etape titre="Téléchargez l'installeur">
            <p>Cliquez sur « Installeur » ci-dessus. Le fichier <b>ForgeChat-Setup-v….exe</b> arrive dans votre dossier Téléchargements.</p>
          </Etape>
          <Etape titre="Lancez-le, puis passez l'écran bleu « Windows a protégé votre ordinateur »">
            <p>ForgeChat n'achète pas de certificat payant : Windows SmartScreen affiche donc un avertissement la première fois. C'est normal.</p>
            <div className="site-mock">Cliquez sur <b>Informations complémentaires</b>, puis sur <b>Exécuter quand même</b>.</div>
          </Etape>
          <Etape titre="Suivez l'installation">
            <p>Choisissez « pour moi seulement » (aucun droit administrateur) ou « pour tous les utilisateurs ». ForgeChat s'ouvre à la fin.</p>
          </Etape>
          <Etape titre="Connectez-vous">
            <p>Utilisez le même compte que sur le web : vos serveurs, messages et amis sont déjà là.</p>
          </Etape>
        </Etapes>
        <div className="site-note reveal" style={{ marginTop: 24 }}>
          <b>Version portable</b> : un seul fichier .exe, à poser où vous voulez (clé USB comprise). Double-cliquez dessus ; le même avertissement SmartScreen s'affiche la première fois.
        </div>
        <MisesAJour>
          <p>Au démarrage puis toutes les 6 heures, ForgeChat vérifie s'il existe une nouvelle version. Un bandeau propose « Mettre à jour » : le fichier est téléchargé, son empreinte vérifiée, puis l'application se met à jour et redémarre toute seule. La version portable remplace son propre fichier.</p>
        </MisesAJour>
      </div>
    </>
  )
}

function MacOS() {
  const r = useDesktopRelease()
  const dmg = r?.platforms['macos-dmg']
  return (
    <>
      <EnTete titre="macOS" os="macos" release={r}>
        <Bouton a={dmg} titre="Télécharger pour Mac" sous="Apple Silicon et Intel" primaire />
      </EnTete>
      <div className="site-wrap">
        <Empreinte a={dmg} />
        <h2 className="site-h2 reveal">Installer pas à pas</h2>
        <Etapes>
          <Etape titre="Ouvrez le fichier .dmg">
            <p>Double-cliquez sur <b>ForgeChat-v…-macos.dmg</b> dans Téléchargements.</p>
          </Etape>
          <Etape titre="Glissez ForgeChat dans Applications">
            <div className="site-mock">Faites glisser l'icône <b>ForgeChat</b> sur le dossier <b>Applications</b>, puis éjectez le disque.</div>
          </Etape>
          <Etape titre="Autorisez l'ouverture (une seule fois)">
            <p>ForgeChat n'est pas notarié par Apple (c'est payant) : macOS bloque la première ouverture.</p>
            <div className="site-mock">
              Ouvrez ForgeChat, cliquez <b>OK</b> sur le message, puis allez dans <b>Réglages Système → Confidentialité et sécurité</b>, descendez jusqu'à « ForgeChat a été bloqué » et cliquez <b>Ouvrir quand même</b>. Confirmez avec votre mot de passe.
            </div>
            <p>Méthode alternative, dans le Terminal :</p>
            <Copier texte="xattr -dr com.apple.quarantine /Applications/ForgeChat.app" />
          </Etape>
          <Etape titre="Autorisez le micro et la caméra">
            <p>À votre premier appel, macOS demande l'accès au micro puis à la caméra : cliquez <b>Autoriser</b>.</p>
          </Etape>
        </Etapes>
        <MisesAJour>
          <p>ForgeChat vérifie les nouvelles versions au démarrage. « Mettre à jour » télécharge la nouvelle application, vérifie son empreinte, la met à la place de l'ancienne dans Applications et redémarre.</p>
        </MisesAJour>
      </div>
    </>
  )
}

function Linux() {
  const r = useDesktopRelease()
  const deb = r?.platforms['linux-x86_64']
  const rpm = r?.platforms['linux-rpm']
  const arch = r?.platforms['linux-arch']
  const flatpak = r?.platforms['linux-flatpak']
  const app = r?.platforms['linux-portable']
  const nom = (a?: Artefact) => (a ? a.url.split('/').pop() : '…')
  return (
    <>
      <EnTete titre="Linux" os="linux" release={r}>
        <Bouton a={deb} titre=".deb" sous="Ubuntu, Debian, Mint" primaire />
        <Bouton a={rpm} titre=".rpm" sous="Fedora, openSUSE" />
        <Bouton a={arch} titre=".pkg.tar.zst" sous="Arch, Omarchy, Manjaro" />
        <Bouton a={flatpak} titre="Flatpak" sous="toutes distributions" />
        <Bouton a={app} titre="AppImage" sous="toutes distributions" />
      </EnTete>
      <div className="site-wrap">
        <h2 className="site-h2 reveal">Installer pas à pas</h2>
        <Etapes>
          <Etape titre="Ubuntu, Debian, Linux Mint (.deb)">
            <p>Double-cliquez sur le fichier pour l'ouvrir dans la Logithèque, ou dans un terminal :</p>
            <Copier texte={`sudo apt install ./${nom(deb)}`} />
          </Etape>
          <Etape titre="Fedora, openSUSE (.rpm)">
            <Copier texte={`sudo dnf install ./${nom(rpm)}`} />
          </Etape>
          <Etape titre="Arch, Omarchy, Manjaro, EndeavourOS (.pkg.tar.zst)">
            <Copier texte={`sudo pacman -U ./${nom(arch)}`} />
          </Etape>
          <Etape titre="N'importe quelle distribution (Flatpak)">
            <p>Flatpak installe aussi le socle GNOME depuis Flathub au premier passage :</p>
            <Copier texte={`flatpak install --user ./${nom(flatpak)}`} />
          </Etape>
          <Etape titre="N'importe quelle distribution (AppImage)">
            <p>Rendez le fichier exécutable puis lancez-le :</p>
            <Copier texte={`chmod +x ${nom(app)} && ./${nom(app)}`} />
          </Etape>
          <Etape titre="Si la fenêtre reste blanche">
            <p>Lancez « ForgeChat (mode compatibilité) » depuis le menu des applications : rendu logiciel, fonctionne sans carte graphique.</p>
          </Etape>
        </Etapes>
        <MisesAJour>
          <p>L'AppImage se remplace elle-même. Avec le .deb, le .rpm ou le paquet Arch, ForgeChat télécharge et vérifie le nouveau paquet puis l'ouvre dans votre installeur : il ne reste qu'à valider avec votre mot de passe. Le Flatpak télécharge et vérifie le nouveau paquet, puis vous donne la commande qui l'installe.</p>
        </MisesAJour>
      </div>
    </>
  )
}

function Android() {
  const r = useMobileRelease()
  const apk = r?.platforms.android
  return (
    <>
      <EnTete titre="Android" os="mobile" release={r}>
        <Bouton a={apk} titre="Télécharger l'APK" sous="Android 7 et plus" primaire />
      </EnTete>
      <div className="site-wrap">
        <Empreinte a={apk} />
        <p className="site-muted" style={{ fontSize: '.8rem', wordBreak: 'break-all' }}>
          Certificat de signature (Heiphaistos &amp; aerwx), SHA-256 : 3C:5B:A3:B3:41:27:54:F7:55:AD:0F:85:D9:BD:FA:92:FB:10:F4:4C:ED:C6:80:A4:4F:41:59:D9:B5:1E:E2:AA
        </p>
        <h2 className="site-h2 reveal">Installer pas à pas</h2>
        <Etapes>
          <Etape titre="Téléchargez l'APK depuis votre téléphone">
            <p>Ouvrez cette page sur le téléphone et touchez « Télécharger l'APK ». Si le navigateur prévient que « ce type de fichier peut être dangereux », touchez <b>Télécharger quand même</b>.</p>
          </Etape>
          <Etape titre="Ouvrez le fichier">
            <p>Touchez la notification « Téléchargement terminé », ou ouvrez <b>Fichiers → Téléchargements → ForgeChat-….apk</b>.</p>
          </Etape>
          <Etape titre="Autorisez l'installation depuis cette source (une seule fois)">
            <div className="site-mock">Android affiche « Pour votre sécurité, votre téléphone n'est pas autorisé à installer des applis inconnues ». Touchez <b>Paramètres</b>, activez <b>Autoriser cette source</b>, puis revenez en arrière.</div>
          </Etape>
          <Etape titre="Installez, et passez Play Protect si besoin">
            <p>Touchez <b>Installer</b>. Si Play Protect affiche « Application inconnue », touchez <b>Plus d'infos → Installer quand même</b> (l'app n'est pas sur le Play Store, c'est la seule raison).</p>
          </Etape>
          <Etape titre="Ouvrez ForgeChat et connectez-vous">
            <p>Même compte que sur le web. L'app demandera le micro et la caméra au premier appel.</p>
          </Etape>
        </Etapes>
        <MisesAJour>
          <p>Une fois par jour, l'app demande au serveur ForgeChat s'il existe une nouvelle version et propose de la télécharger. Ouvrez le fichier : Android l'installe par-dessus l'ancienne, vos données sont conservées. Android refuse toute version qui ne serait pas signée avec la même clé que l'app installée.</p>
        </MisesAJour>
      </div>
    </>
  )
}

function IPhone() {
  const r = useMobileRelease()
  const ipa = r?.platforms.ios
  return (
    <>
      <EnTete titre="iPhone et iPad" os="mobile" release={r}>
        <a href="#web-app" className="site-btn site-btn-primary">Web app (le plus simple)</a>
        <a href="#app-native" className="site-btn site-btn-ghost">App native (AltStore / SideStore)</a>
      </EnTete>
      <div className="site-wrap">
        <p className="site-lead reveal">ForgeChat ne passe pas par l'App Store (payant). Deux façons gratuites de l'avoir sur iPhone :</p>

        <h2 id="web-app" className="site-h2 reveal" style={{ marginTop: 40 }}>1. La web app : 1 minute, rien à installer</h2>
        <Etapes>
          <Etape titre="Ouvrez forgechat.heiphaistos.org dans Safari" />
          <Etape titre="Touchez le bouton Partager">
            <div className="site-mock">Le carré avec une flèche vers le haut, en bas de l'écran (en haut sur iPad).</div>
          </Etape>
          <Etape titre="Choisissez « Sur l'écran d'accueil », puis « Ajouter »">
            <p>ForgeChat apparaît sur l'écran d'accueil et s'ouvre en plein écran, comme une app. Notifications possibles depuis iOS 16.4.</p>
          </Etape>
        </Etapes>
        <MisesAJour><p>La web app est toujours à jour : chaque nouvelle version est proposée automatiquement à l'ouverture.</p></MisesAJour>

        <h2 id="app-native" className="site-h2 reveal">2. L'app native, avec un identifiant Apple gratuit</h2>
        <p className="site-muted reveal">Elle s'installe avec AltStore ou SideStore, deux outils gratuits qui signent l'app avec votre propre identifiant Apple.</p>
        <Etapes>
          <Etape titre="Installez AltStore sur l'iPhone">
            <p>Suivez le guide officiel sur <a href="https://altstore.io" target="_blank" rel="noopener noreferrer">altstore.io</a> (il faut un PC ou un Mac la première fois, avec AltServer). SideStore (<a href="https://sidestore.io" target="_blank" rel="noopener noreferrer">sidestore.io</a>) fonctionne aussi, sans ordinateur ensuite.</p>
          </Etape>
          <Etape titre="Activez le mode développeur">
            <div className="site-mock"><b>Réglages → Confidentialité et sécurité → Mode développeur</b>, activez, redémarrez l'iPhone.</div>
          </Etape>
          <Etape titre="Ajoutez la source ForgeChat">
            <p>Dans AltStore : <b>Sources → +</b>, puis collez :</p>
            <Copier texte={ALTSTORE_SOURCE} />
          </Etape>
          <Etape titre="Installez ForgeChat">
            <p>Ouvrez la source ForgeChat et touchez <b>Gratuit / Installer</b>. Puis <b>Réglages → Général → VPN et gestion de l'appareil</b> → votre identifiant → <b>Faire confiance</b>.</p>
          </Etape>
        </Etapes>
        <div className="site-note reveal" style={{ marginTop: 24 }}>
          Avec un identifiant Apple gratuit, Apple limite la signature à 7 jours : AltStore / SideStore la renouvellent tout seuls en arrière-plan. Vous préférez Sideloadly ? Le fichier IPA direct :{' '}
          {ipa ? <a href={artefactUrl(ipa)} download>ForgeChat-{r?.version}.ipa</a> : 'bientôt disponible'}.
        </div>
        <Empreinte a={ipa} />
        <MisesAJour><p>La source ForgeChat annonce chaque nouvelle version : AltStore / SideStore la proposent dans « Mises à jour » et l'installent par-dessus l'ancienne.</p></MisesAJour>
      </div>
    </>
  )
}

function Web() {
  return (
    <>
      <EnTete titre="votre navigateur" os="web" release={null}>
        <Link to="/register" className="site-btn site-btn-primary">Créer un compte</Link>
        <Link to="/login" className="site-btn site-btn-ghost">Se connecter</Link>
      </EnTete>
      <div className="site-wrap">
        <p className="site-lead reveal">Chrome, Edge, Firefox, Safari, Brave… ForgeChat fonctionne directement dans le navigateur, appels et partage d'écran compris.</p>
        <MisesAJour><p>Toujours la dernière version : quand une mise à jour est en ligne, un bandeau propose de recharger la page.</p></MisesAJour>
      </div>
    </>
  )
}

const PAGES: Record<Plateforme, () => ReactNode> = {
  windows: Windows, macos: MacOS, linux: Linux, android: Android, iphone: IPhone, web: Web,
}

export function TelechargerPlateformePage() {
  const { plateforme } = useParams()
  const Page = PAGES[plateforme as Plateforme]
  if (!Page) return <Navigate to="/telecharger" replace />
  return <SiteLayout><Page /></SiteLayout>
}

export default function TelechargerPage() {
  const mienne = plateformeDuVisiteur()
  const bureau = useDesktopRelease()
  const mobile = useMobileRelease()
  return (
    <SiteLayout>
      <section className="site-hero">
        <div className="site-wrap">
          <span className="site-eyebrow"><ShieldCheck size={16} /> Gratuit · sans publicité · mises à jour automatiques</span>
          <h1 className="site-h1 reveal">Télécharger <span className="grad">ForgeChat</span></h1>
          <p className="site-lead reveal">
            Choisissez votre appareil : chaque page explique l'installation pas à pas.
            {bureau && <> Bureau {bureau.version}.</>}
            {mobile && <> Mobile {mobile.version}.</>}
          </p>
        </div>
      </section>
      <section className="site-wrap" style={{ paddingBottom: 96 }}>
        <div className="site-grid">
          {PLATEFORMES.map((p, i) => (
            <Link
              key={p.id}
              to={`/telecharger/${p.id}`}
              className={`site-card site-card-link reveal ${p.id === mienne ? 'is-mine' : ''}`}
              style={{ '--i': i } as React.CSSProperties}
            >
              <div className="ico">{p.icone}</div>
              <h2 className="site-h3">{p.nom} {p.id === mienne && <span className="site-badge">votre appareil</span>}</h2>
              <p className="site-muted" style={{ margin: 0 }}>{p.resume}</p>
            </Link>
          ))}
        </div>
      </section>
    </SiteLayout>
  )
}
