import { Link } from 'react-router-dom'
import { Bouton, Copier, Empreinte, EnTete, Etape, Etapes, MisesAJour } from '../dlKit'
import { ALTSTORE_SOURCE, artefactUrl, useDesktopRelease, useMobileRelease, type Artefact, type Plateforme } from '../releases'

// Installation guides per platform (English translation of fr.tsx, which is the reference).
// The button labels of Windows, macOS and Android quote the system dialogs in English.

function Windows() {
  const r = useDesktopRelease()
  const setup = r?.platforms['windows-x86_64']
  return (
    <>
      <EnTete titre="Windows" os="windows" release={r}>
        <Bouton a={setup} titre="Installer" sous="recommended" primaire />
        <Bouton a={r?.platforms['windows-portable']} titre="Portable version" sous="no installation" />
      </EnTete>
      <div className="site-wrap">
        <Empreinte a={setup} />
        <h2 className="site-h2 reveal">Step-by-step installation</h2>
        <Etapes>
          <Etape titre="Download the installer">
            <p>Click “Installer” above. The file <b>ForgeChat-Setup-v….exe</b> lands in your Downloads folder.</p>
          </Etape>
          <Etape titre="Run it, then get past the blue “Windows protected your PC” screen">
            <p>ForgeChat does not buy a paid certificate, so Windows SmartScreen shows a warning the first time. This is normal.</p>
            <div className="site-mock">Click <b>More info</b>, then <b>Run anyway</b>.</div>
          </Etape>
          <Etape titre="Follow the installation">
            <p>Choose “just for me” (no administrator rights) or “for all users”. ForgeChat opens at the end.</p>
          </Etape>
          <Etape titre="Sign in">
            <p>Use the same account as on the web: your servers, messages and friends are already there.</p>
          </Etape>
        </Etapes>
        <div className="site-note reveal" style={{ marginTop: 24 }}>
          <b>Portable version</b>: a single .exe file, to put wherever you like (USB stick included). Double-click it; the same SmartScreen warning appears the first time.
        </div>
        <MisesAJour>
          <p>At startup and then every 6 hours, ForgeChat checks whether a new version exists. A banner offers “Update”: the file is downloaded, its fingerprint checked, then the app updates and restarts by itself. The portable version replaces its own file.</p>
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
        <Bouton a={dmg} titre="Download for Mac" sous="Apple Silicon and Intel" primaire />
      </EnTete>
      <div className="site-wrap">
        <Empreinte a={dmg} />
        <h2 className="site-h2 reveal">Step-by-step installation</h2>
        <Etapes>
          <Etape titre="Open the .dmg file">
            <p>Double-click <b>ForgeChat-v…-macos.dmg</b> in Downloads.</p>
          </Etape>
          <Etape titre="Drag ForgeChat into Applications">
            <div className="site-mock">Drag the <b>ForgeChat</b> icon onto the <b>Applications</b> folder, then eject the disk.</div>
          </Etape>
          <Etape titre="Allow it to open (only once)">
            <p>ForgeChat is not notarized by Apple (that costs money): macOS blocks the first launch.</p>
            <div className="site-mock">
              Open ForgeChat, click <b>OK</b> on the message, then go to <b>System Settings → Privacy &amp; Security</b>, scroll down to “ForgeChat was blocked” and click <b>Open Anyway</b>. Confirm with your password.
            </div>
            <p>Alternative method, in Terminal:</p>
            <Copier texte="xattr -dr com.apple.quarantine /Applications/ForgeChat.app" />
          </Etape>
          <Etape titre="Allow the microphone and camera">
            <p>On your first call, macOS asks for access to the microphone and then the camera: click <b>Allow</b>.</p>
          </Etape>
        </Etapes>
        <MisesAJour>
          <p>ForgeChat checks for new versions at startup. “Update” downloads the new app, checks its fingerprint, puts it in place of the old one in Applications and restarts.</p>
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
  const app = r?.platforms['linux-portable']
  const nom = (a?: Artefact) => (a ? a.url.split('/').pop() : '…')
  return (
    <>
      <EnTete titre="Linux" os="linux" release={r}>
        <Bouton a={deb} titre=".deb" sous="Ubuntu, Debian, Mint" primaire />
        <Bouton a={rpm} titre=".rpm" sous="Fedora, openSUSE" />
        <Bouton a={arch} titre=".pkg.tar.zst" sous="Arch, Omarchy, Manjaro" />
        <Bouton a={app} titre="AppImage" sous="all distributions" />
      </EnTete>
      <div className="site-wrap">
        <h2 className="site-h2 reveal">Step-by-step installation</h2>
        <Etapes>
          <Etape titre="Ubuntu, Debian, Linux Mint (.deb)">
            <p>Double-click the file to open it in your software center, or in a terminal:</p>
            <Copier texte={`sudo apt install ./${nom(deb)}`} />
          </Etape>
          <Etape titre="Fedora, openSUSE (.rpm)">
            <Copier texte={`sudo dnf install ./${nom(rpm)}`} />
          </Etape>
          <Etape titre="Arch, Omarchy, Manjaro, EndeavourOS (.pkg.tar.zst)">
            <Copier texte={`sudo pacman -U ./${nom(arch)}`} />
          </Etape>
          <Etape titre="Any distribution (AppImage)">
            <p>Make the file executable, then run it:</p>
            <Copier texte={`chmod +x ${nom(app)} && ./${nom(app)}`} />
          </Etape>
          <Etape titre="If the window stays white">
            <p>Launch “ForgeChat (compatibility mode)” from the applications menu: software rendering, works without a graphics card.</p>
          </Etape>
        </Etapes>
        <MisesAJour>
          <p>The AppImage replaces itself. With the .deb, the .rpm or the Arch package, ForgeChat downloads and checks the new package, then opens it in your installer: all that is left is to confirm with your password.</p>
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
        <Bouton a={apk} titre="Download the APK" sous="Android 7 and later" primaire />
      </EnTete>
      <div className="site-wrap">
        <Empreinte a={apk} />
        <p className="site-muted" style={{ fontSize: '.8rem', wordBreak: 'break-all' }}>
          Signing certificate (Heiphaistos &amp; aerwx), SHA-256: 3C:5B:A3:B3:41:27:54:F7:55:AD:0F:85:D9:BD:FA:92:FB:10:F4:4C:ED:C6:80:A4:4F:41:59:D9:B5:1E:E2:AA
        </p>
        <h2 className="site-h2 reveal">Step-by-step installation</h2>
        <Etapes>
          <Etape titre="Download the APK from your phone">
            <p>Open this page on the phone and tap “Download the APK”. If the browser warns that “this type of file can harm your device”, tap <b>Download anyway</b>.</p>
          </Etape>
          <Etape titre="Open the file">
            <p>Tap the “Download complete” notification, or open <b>Files → Downloads → ForgeChat-….apk</b>.</p>
          </Etape>
          <Etape titre="Allow installation from this source (only once)">
            <div className="site-mock">Android shows “For your security, your phone is not allowed to install unknown apps from this source”. Tap <b>Settings</b>, turn on <b>Allow from this source</b>, then go back.</div>
          </Etape>
          <Etape titre="Install, and get past Play Protect if needed">
            <p>Tap <b>Install</b>. If Play Protect shows “Unknown app”, tap <b>More details → Install anyway</b> (the app is not on the Play Store, that is the only reason).</p>
          </Etape>
          <Etape titre="Open ForgeChat and sign in">
            <p>Same account as on the web. The app will ask for the microphone and camera on the first call.</p>
          </Etape>
        </Etapes>
        <MisesAJour>
          <p>Once a day, the app asks the ForgeChat server whether a new version exists and offers to download it. Open the file: Android installs it over the old one, your data is kept. Android refuses any version that is not signed with the same key as the installed app.</p>
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
      <EnTete titre="iPhone and iPad" os="mobile" release={r}>
        <a href="#web-app" className="site-btn site-btn-primary">Web app (the simplest)</a>
        <a href="#app-native" className="site-btn site-btn-ghost">Native app (AltStore / SideStore)</a>
      </EnTete>
      <div className="site-wrap">
        <p className="site-lead reveal">ForgeChat does not go through the App Store (paid). Two free ways to get it on iPhone:</p>

        <h2 id="web-app" className="site-h2 reveal" style={{ marginTop: 40 }}>1. The web app: 1 minute, nothing to install</h2>
        <Etapes>
          <Etape titre="Open forgechat.heiphaistos.org in Safari" />
          <Etape titre="Tap the Share button">
            <div className="site-mock">The square with an arrow pointing up, at the bottom of the screen (at the top on iPad).</div>
          </Etape>
          <Etape titre="Choose “Add to Home Screen”, then “Add”">
            <p>ForgeChat appears on the home screen and opens full screen, like an app. Notifications are possible since iOS 16.4.</p>
          </Etape>
        </Etapes>
        <MisesAJour><p>The web app is always up to date: each new version is offered automatically when you open it.</p></MisesAJour>

        <h2 id="app-native" className="site-h2 reveal">2. The native app, with a free Apple ID</h2>
        <p className="site-muted reveal">It is installed with AltStore or SideStore, two free tools that sign the app with your own Apple ID.</p>
        <Etapes>
          <Etape titre="Install AltStore on the iPhone">
            <p>Follow the official guide on <a href="https://altstore.io" target="_blank" rel="noopener noreferrer">altstore.io</a> (you need a PC or a Mac the first time, with AltServer). SideStore (<a href="https://sidestore.io" target="_blank" rel="noopener noreferrer">sidestore.io</a>) also works, without a computer afterwards.</p>
          </Etape>
          <Etape titre="Turn on Developer Mode">
            <div className="site-mock"><b>Settings → Privacy &amp; Security → Developer Mode</b>, turn it on, restart the iPhone.</div>
          </Etape>
          <Etape titre="Add the ForgeChat source">
            <p>In AltStore: <b>Sources → +</b>, then paste:</p>
            <Copier texte={ALTSTORE_SOURCE} />
          </Etape>
          <Etape titre="Install ForgeChat">
            <p>Open the ForgeChat source and tap <b>Free / Install</b>. Then <b>Settings → General → VPN &amp; Device Management</b> → your Apple ID → <b>Trust</b>.</p>
          </Etape>
        </Etapes>
        <div className="site-note reveal" style={{ marginTop: 24 }}>
          With a free Apple ID, Apple limits the signature to 7 days: AltStore / SideStore renew it on their own in the background. Prefer Sideloadly? The direct IPA file:{' '}
          {ipa ? <a href={artefactUrl(ipa)} download>ForgeChat-{r?.version}.ipa</a> : 'coming soon'}.
        </div>
        <Empreinte a={ipa} />
        <MisesAJour><p>The ForgeChat source announces each new version: AltStore / SideStore offer it under “Updates” and install it over the old one.</p></MisesAJour>
      </div>
    </>
  )
}

function Web() {
  return (
    <>
      <EnTete titre="your browser" os="web" release={null}>
        <Link to="/register" className="site-btn site-btn-primary">Create an account</Link>
        <Link to="/login" className="site-btn site-btn-ghost">Sign in</Link>
      </EnTete>
      <div className="site-wrap">
        <p className="site-lead reveal">Chrome, Edge, Firefox, Safari, Brave… ForgeChat works directly in the browser, calls and screen sharing included.</p>
        <MisesAJour><p>Always the latest version: when an update is online, a banner offers to reload the page.</p></MisesAJour>
      </div>
    </>
  )
}

export const guidesEn: Record<Plateforme, () => React.ReactNode> = {
  windows: Windows, macos: MacOS, linux: Linux, android: Android, iphone: IPhone, web: Web,
}
