import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import Logo3D from '../components/Logo3D'

// Mentions légales, politique de confidentialité et CGU propres à forgechat.heiphaistos.org.
// Date de mise à jour écrite en dur : elle ne doit changer que si le texte change.
const CONTACT = 'contact.forgeinformatique@heiphaistos.org'
const UPDATED = '1er octobre 2026'

function Mail() {
  return <a href={`mailto:${CONTACT}`} className="text-fc-accent hover:underline break-all">{CONTACT}</a>
}

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className="text-fc-accent hover:underline">{children}</a>
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-fc-muted">{children}</div>
    </section>
  )
}

export function LegalLinks({ className = '' }: { className?: string }) {
  return (
    <nav aria-label="Informations légales" className={`flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-fc-muted ${className}`}>
      <Link to="/mentions-legales" className="py-1 hover:text-white transition">Mentions légales</Link>
      <Link to="/confidentialite" className="py-1 hover:text-white transition">Confidentialité</Link>
      <Link to="/cgu" className="py-1 hover:text-white transition">Conditions d'utilisation</Link>
    </nav>
  )
}

function Shell({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <div className="h-screen overflow-y-auto bg-fc-bg">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-fc-muted hover:text-white transition">
          <Logo3D size={28} /> ← ForgeChat
        </Link>
        <h1 className="mt-6 text-2xl sm:text-3xl font-bold text-white break-words">{title}</h1>
        <p className="mt-1 text-sm text-fc-muted">Dernière mise à jour : {UPDATED}</p>
        {intro && <div className="mt-6 text-sm leading-relaxed text-fc-muted">{intro}</div>}
        {children}
        <LegalLinks className="mt-12 justify-start" />
      </div>
    </div>
  )
}

export function MentionsLegalesPage() {
  return (
    <Shell title="Mentions légales">
      <Block title="Éditeur du site">
        <p>
          Le site et le service <strong className="text-white">forgechat.heiphaistos.org</strong> (ainsi que les applications ForgeChat pour Windows et
          Linux) sont édités à titre personnel et non professionnel par une personne physique publiant sous le pseudonyme{' '}
          <strong className="text-white">Heiphaistos</strong>.
        </p>
        <p>
          Conformément à la loi n° 2004-575 du 21 juin 2004 pour la confiance dans l'économie numérique (LCEN, article 6-III-2), l'éditeur, non
          professionnel, a choisi de préserver son anonymat. Ses éléments d'identification ont été communiqués à l'hébergeur, qui en garantit la
          confidentialité.
        </p>
        <p>Contact : <Mail /></p>
      </Block>
      <Block title="Directeur de la publication">
        <p>L'éditeur du site, tel que désigné ci-dessus.</p>
      </Block>
      <Block title="Hébergement">
        <p>
          <strong className="text-white">IONOS SE</strong> — Elgendorfer Str. 57, 56410 Montabaur, Allemagne — Tél. : +49 721 170 555 —{' '}
          <Ext href="https://www.ionos.fr">ionos.fr</Ext>
        </p>
      </Block>
      <Block title="Propriété intellectuelle">
        <p>
          Les textes, visuels, logos et le code de ForgeChat sont la propriété de leur éditeur ; toute reproduction sans autorisation écrite préalable est
          interdite. Les contenus publiés par les utilisateurs (messages, fichiers, images) restent la propriété de leurs auteurs, qui en sont
          responsables. Les marques citées appartiennent à leurs propriétaires ; ForgeChat n'est pas affilié à Discord.
        </p>
      </Block>
      <Block title="Responsabilité et hébergement de contenus">
        <p>
          Pour les contenus publiés par les utilisateurs, l'éditeur agit comme hébergeur au sens de l'article 6 de la LCEN : il n'en contrôle pas la
          publication, mais retire promptement tout contenu manifestement illicite qui lui est signalé.
        </p>
      </Block>
      <Block title="Signaler un contenu">
        <p>
          Utilisez la fonction « Signaler » d'un message, ou écrivez à <Mail /> en précisant le serveur, le salon et le message concernés.
        </p>
      </Block>
    </Shell>
  )
}

export function ConfidentialitePage() {
  return (
    <Shell
      title="Politique de confidentialité"
      intro={
        <p>
          En bref : ForgeChat est une messagerie avec compte. Le serveur conserve ce qu'il faut pour faire fonctionner le service (compte, messages,
          fichiers), <strong className="text-white">sans publicité, sans revente, sans mesure d'audience</strong>. Les messages ne sont pas chiffrés de
          bout en bout : techniquement, l'administrateur du serveur peut y accéder.
        </p>
      }
    >
      <Block title="Responsable de traitement">
        <p>L'éditeur du site (voir les <Link to="/mentions-legales" className="text-fc-accent hover:underline">mentions légales</Link>), joignable à <Mail />.</p>
      </Block>
      <Block title="Compte">
        <p>
          Nom d'utilisateur, adresse e-mail, mot de passe (stocké uniquement sous forme hachée bcrypt), date de création, et ce que vous ajoutez à
          votre profil (avatar, bannière, bio, statut, pronoms…). Si vous activez la double authentification, le secret TOTP est conservé. Base
          légale : exécution du service (article 6.1.b du RGPD). Conservation : jusqu'à la suppression du compte.
        </p>
      </Block>
      <Block title="Messages, fichiers et activité">
        <p>
          Les messages (salons, messages privés, groupes, fils, forums), réactions, sondages, fichiers et images envoyés, ainsi que vos serveurs,
          rôles, amis, blocages, signalements et réglages, sont conservés jusqu'à leur suppression par vous, par la modération du serveur concerné, ou
          à leur expiration pour les messages éphémères. Les actions de modération sont inscrites au journal d'audit du serveur concerné.
        </p>
        <p>
          À la suppression du compte, vos données de profil, sessions et relations sont effacées ; les messages déjà publiés dans des serveurs ou
          conversations partagées restent visibles des autres participants, attribués à « Utilisateur supprimé ».
        </p>
      </Block>
      <Block title="Sessions et sécurité">
        <p>
          Chaque connexion crée une session (appareil et navigateur, adresse IP, dernière activité), visible et révocable dans vos paramètres ;
          elle est supprimée à la déconnexion ou à la réinitialisation du mot de passe. Base légale : intérêt légitime (sécurité du compte).
        </p>
        <p>
          Le serveur web enregistre pour chaque requête l'adresse IP, la date, l'adresse demandée et le navigateur utilisé. Finalité : sécurité,
          prévention des abus et diagnostic. Conservation : 12 mois maximum.
        </p>
      </Block>
      <Block title="Rapports d'erreurs">
        <p>
          Quand l'application plante ou n'arrive pas à démarrer, elle envoie automatiquement un rapport technique à ce serveur : plateforme, version,
          message d'erreur, pile d'appels, navigateur et page concernée, et votre identifiant si vous êtes connecté. Ces rapports, lus uniquement par
          l'administrateur, sont effacés 30 jours après leur dernière occurrence. Base légale : intérêt légitime (corriger les pannes).
        </p>
      </Block>
      <Block title="Appels vocaux et vidéo">
        <p>
          Les appels passent par le serveur de visioconférence de ForgeChat, hébergé sur la même machine. Ils ne sont pas enregistrés.
        </p>
      </Block>
      <Block title="E-mails">
        <p>
          L'adresse e-mail sert à vérifier le compte et à réinitialiser le mot de passe. Ces e-mails sont envoyés par le serveur de messagerie d'IONOS.
        </p>
      </Block>
      <Block title="Services tiers, seulement quand vous les utilisez">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong className="text-white">GIF</strong> : le sélecteur de GIF interroge depuis votre navigateur l'API Tenor de Google (États-Unis), qui
            reçoit votre recherche et votre adresse IP.
          </li>
          <li>
            <strong className="text-white">Traduction</strong> : traduire un message envoie son texte, depuis le serveur, au service MyMemory (Translated
            srl, Italie). Votre adresse IP n'est pas transmise.
          </li>
          <li>
            <strong className="text-white">QR code d'invitation</strong> : l'image est générée par api.qrserver.com (goQR.me, Allemagne), qui reçoit le
            lien d'invitation et votre adresse IP.
          </li>
          <li>
            <strong className="text-white">Notifications push</strong> : si vous les autorisez, les notifications passent par le service push de votre
            navigateur (Google, Mozilla, Apple…), chiffrées de bout en bout entre ce serveur et votre navigateur.
          </li>
          <li>
            <strong className="text-white">Import Discord</strong> : si vous importez une archive, le serveur la télécharge depuis ForgeArchive
            (forgearchive.heiphaistos.org, même éditeur).
          </li>
        </ul>
        <p>Aucune police n'est chargée depuis un service tiers.</p>
      </Block>
      <Block title="Cookies et stockage local">
        <p>
          ForgeChat dépose deux cookies <strong className="text-white">strictement nécessaires</strong> (HttpOnly) qui vous gardent connecté : le jeton
          d'accès (24 h) et le jeton de rafraîchissement (30 jours). Le stockage local de votre navigateur garde ces jetons et vos préférences
          d'affichage et d'audio (thème, zoom, micro et haut-parleur choisis, dernier salon ouvert, dossiers de serveurs…). Aucun traceur
          publicitaire ou de mesure d'audience : aucun consentement n'est donc demandé.
        </p>
      </Block>
      <Block title="Destinataires">
        <p>
          Les données sont hébergées par IONOS SE dans l'Union européenne. Les contenus que vous publiez sont visibles des membres des serveurs et
          conversations concernés. Les données ne sont ni vendues, ni cédées, ni utilisées pour du profilage ou de la publicité.
        </p>
      </Block>
      <Block title="Vos droits">
        <p>
          Vous disposez des droits d'accès, de rectification, d'effacement, de limitation, d'opposition et de portabilité (articles 15 à 22 du RGPD).
          Vous pouvez exporter vos données et supprimer votre compte depuis les paramètres, ou écrire à <Mail /> — réponse sous un mois.
        </p>
        <p>En cas de désaccord, vous pouvez saisir la CNIL : <Ext href="https://www.cnil.fr">cnil.fr</Ext>.</p>
      </Block>
    </Shell>
  )
}

export function CguPage() {
  return (
    <Shell
      title="Conditions d'utilisation"
      intro={
        <p>
          Les présentes conditions générales d'utilisation (CGU) s'appliquent au service ForgeChat (forgechat.heiphaistos.org et applications de
          bureau). Elles sont acceptées lors de la création du compte.
        </p>
      }
    >
      <Block title="Objet">
        <p>ForgeChat est une messagerie communautaire : serveurs, salons, messages privés, appels vocaux et vidéo, partage de fichiers.</p>
      </Block>
      <Block title="Gratuité">
        <p>Le service est gratuit, sans abonnement, sans achat intégré et sans publicité.</p>
      </Block>
      <Block title="Compte">
        <p>
          Il faut avoir au moins 15 ans, ou l'accord d'un parent, pour créer un compte. Vous fournissez une adresse e-mail valide et gardez votre mot
          de passe secret ; vous êtes responsable de l'activité de votre compte. Vous pouvez le supprimer à tout moment depuis les paramètres.
        </p>
      </Block>
      <Block title="Contenus et comportement">
        <p>
          Vous êtes responsable des contenus que vous publiez. Sont interdits : les contenus illicites (haine, harcèlement, menaces, apologie du
          terrorisme, contenus pédopornographiques, atteinte à la vie privée ou au droit d'auteur), le spam, les logiciels malveillants,
          l'usurpation d'identité, ainsi que toute tentative d'atteinte à la sécurité ou à la disponibilité du service.
        </p>
        <p>
          Chaque serveur est modéré par son propriétaire et les rôles qu'il désigne, qui peuvent ajouter leurs propres règles. L'éditeur peut retirer
          un contenu, suspendre ou supprimer un compte ou un serveur qui enfreint ces conditions, et coopère avec les autorités sur réquisition.
        </p>
      </Block>
      <Block title="Signalement">
        <p>Tout contenu peut être signalé avec la fonction « Signaler » ou par e-mail à <Mail />.</p>
      </Block>
      <Block title="Disponibilité et responsabilité">
        <p>
          Le service est fourni « en l'état », sans garantie de disponibilité ni de conservation des données : gardez une copie de ce qui compte.
          L'éditeur peut le modifier, le suspendre ou l'arrêter à tout moment, et ne pourra être tenu responsable des dommages directs ou indirects
          résultant de son utilisation ou des contenus publiés par les utilisateurs.
        </p>
      </Block>
      <Block title="Modification des conditions">
        <p>Ces conditions peuvent évoluer ; la date de dernière mise à jour figure en haut de page. Continuer à utiliser le service vaut acceptation.</p>
      </Block>
      <Block title="Droit applicable">
        <p>Les présentes conditions sont régies par le droit français. En cas de litige, une solution amiable sera recherchée avant toute action.</p>
      </Block>
      <Block title="Contact">
        <p><Mail /></p>
      </Block>
    </Shell>
  )
}
