import { Link } from 'react-router-dom'
import { Block, Ext, Mail } from './ui'
import type { LegalText } from './fr'

// English translation of the legal texts. The French version (fr.tsx) is the legally binding
// reference: any change there must be carried over here, along with the update date.
export const legalEn: LegalText = {
  updated: 'Last updated: October 1, 2026 · English translation, the French version prevails',
  notice: {
    title: 'Legal notice',
    body: (
      <>
        <Block title="Site publisher">
          <p>
            The website and service <strong className="text-white">forgechat.heiphaistos.org</strong> (as well as the ForgeChat applications for
            Windows and Linux) are published in a personal, non-professional capacity by a natural person publishing under the pseudonym{' '}
            <strong className="text-white">Heiphaistos</strong>.
          </p>
          <p>
            In accordance with French law no. 2004-575 of 21 June 2004 on confidence in the digital economy (LCEN, article 6-III-2), the publisher,
            acting in a non-professional capacity, has chosen to remain anonymous. Their identification details have been provided to the hosting
            provider, which guarantees their confidentiality.
          </p>
          <p>Contact: <Mail /></p>
        </Block>
        <Block title="Publication director">
          <p>The site publisher, as designated above.</p>
        </Block>
        <Block title="Hosting">
          <p>
            <strong className="text-white">IONOS SE</strong> — Elgendorfer Str. 57, 56410 Montabaur, Germany — Tel.: +49 721 170 555 —{' '}
            <Ext href="https://www.ionos.fr">ionos.fr</Ext>
          </p>
        </Block>
        <Block title="Intellectual property">
          <p>
            The texts, visuals, logos and code of ForgeChat are the property of their publisher; any reproduction without prior written permission
            is prohibited. Content posted by users (messages, files, images) remains the property of its authors, who are responsible for it. The
            trademarks mentioned belong to their owners; ForgeChat is not affiliated with Discord.
          </p>
        </Block>
        <Block title="Liability and hosting of content">
          <p>
            For content posted by users, the publisher acts as a hosting provider within the meaning of article 6 of the LCEN: it does not control
            its publication, but promptly removes any manifestly unlawful content reported to it.
          </p>
        </Block>
        <Block title="Reporting content">
          <p>
            Use the “Report” feature on a message, or write to <Mail />, specifying the server, channel and message concerned.
          </p>
        </Block>
      </>
    ),
  },
  privacy: {
    title: 'Privacy policy',
    intro: (
      <p>
        In short: ForgeChat is a messaging service with accounts. The server keeps what is needed to run the service (account, messages, files),{' '}
        <strong className="text-white">with no advertising, no reselling, no audience measurement</strong>. All conversations and all calls are{' '}
        <strong className="text-white">end-to-end encrypted, mandatorily</strong>: the server only keeps encrypted content, unreadable to it and to
        its administrator alike.
      </p>
    ),
    body: (
      <>
        <Block title="Data controller">
          <p>The site publisher (see the <Link to="/mentions-legales" className="text-fc-accent hover:underline">legal notice</Link>), reachable at <Mail />.</p>
        </Block>
        <Block title="Moderation of the instance">
          <p>
            The site administrator (“El Patron” role) moderates the instance. They can see the list of servers (name, owner, number of members,
            channels and messages, volume of files), <strong className="text-white">enter a server without having been invited</strong> to handle a
            report or abusive hosting, and suspend or delete a server or an account. This supervision is{' '}
            <strong className="text-white">visible</strong>: the administrator appears among the server's members and an entry is written to its
            audit log. It gives <strong className="text-white">no access to private messages or to end-to-end encrypted content</strong>: the
            administrator receives no key.
          </p>
        </Block>
        <Block title="End-to-end encryption">
          <p>
            Private messages, groups, server channels, threads, forums, polls, scheduled messages, as well as voice, video and screen sharing are
            encrypted on your devices, with no option to turn it off. Your encryption key is created on your device; the server only keeps one copy
            encrypted with your password and another encrypted with your recovery code, displayed only once. Without your password or recovery
            code, older encrypted content becomes unreadable, including to us. A server owner can create a recovery key for their server to read
            its channels again.
          </p>
          <p>
            What remains visible to the server, because it needs it to work: who writes in which conversation and when, the names of servers and
            channels, usernames, reactions, the people and roles mentioned (to notify them), poll votes and file sizes. What remains in clear text,
            and marked “not encrypted”: messages from bots, webhooks, feeds and system messages, as well as commands sent to a bot. When you report a
            message, its decrypted text is attached to the report for moderation.
          </p>
          <p>
            Limitation: a server modified to lie about members' keys could intercept communications; the security codes shown on profiles let two
            people check this between themselves.
          </p>
          <p>
            Content sent before encryption: the applications re-encrypt it in the background. In server channels, it is never erased; the author,
            the server owner and its moderators can re-encrypt it. In private messages and groups, old text that its author has not re-encrypted 30
            days after encryption went live is erased.
          </p>
        </Block>
        <Block title="Account">
          <p>
            Username, email address, password (stored only as a bcrypt hash), creation date, and whatever you add to your profile (avatar, banner,
            bio, status, pronouns…). If you enable two-factor authentication, the TOTP secret is stored. Legal basis: performance of the service
            (article 6.1.b of the GDPR). Retention: until the account is deleted.
          </p>
        </Block>
        <Block title="Messages, files and activity">
          <p>
            Messages (channels, private messages, groups, threads, forums), reactions, polls, files and images sent, as well as your servers, roles,
            friends, blocks, reports and settings, are kept until they are deleted by you, by the moderation of the server concerned, or until they
            expire for ephemeral messages. Moderation actions are written to the audit log of the server concerned.
          </p>
          <p>
            When the account is deleted, your profile data, sessions and relationships are erased; messages already posted in servers or shared
            conversations remain visible to the other participants, attributed to “Deleted user”.
          </p>
        </Block>
        <Block title="Sessions and security">
          <p>
            Each sign-in creates a session that is visible and revocable in your settings. It only keeps a device label (for example “Firefox ·
            Linux” or “ForgeChat Android”), its creation date and its last activity: <strong className="text-white">no IP address, and no detailed
            browser identifier</strong>. It is deleted on sign-out, on password reset, on revocation, or after 30 days without activity. Legal
            basis: legitimate interest (account security).
          </p>
          <p>
            Against abuse (password guessing, mass sign-ups), the server counts attempts for 15 minutes to 1 hour. These counters live only in
            memory and never use your IP or email address in clear text, only a fingerprint computed with a randomly drawn key renewed every day,
            which nothing can link from one day to the next.
          </p>
          <p>
            The web server keeps no request log. The service's technical logs are limited to 30 MB and overwrite themselves; they contain no email
            address, no IP address and no username, at most the internal identifier of an account (anti-abuse refusals, errors). Only the web
            server's error log (malformed requests, outages) may contain an IP address; it is erased by the system's automatic rotation.
          </p>
        </Block>
        <Block title="Error reports">
          <p>
            When the application crashes or fails to start, it automatically sends an anonymous technical report: platform, version, error message,
            call stack, browser and system (for example “Chrome 129 · Windows”) and the page concerned, with no link to your account. These reports,
            read only by the administrator, are erased 14 days after their last occurrence. Legal basis: legitimate interest (fixing outages).
          </p>
        </Block>
        <Block title="Voice and video calls">
          <p>
            Calls go through ForgeChat's videoconferencing server, hosted on the same machine, end-to-end encrypted (the server only relays
            encrypted frames). They are not recorded. The network relay (TURN), used when a direct connection is impossible, receives a random
            identifier valid for one hour, never your account's, and keeps no log. The call quality measurements sent to the server contain
            neither your account nor your browser.
          </p>
        </Block>
        <Block title="Emails">
          <p>
            The email address is used to verify the account and to reset the password. These emails are sent by IONOS's mail server.
          </p>
        </Block>
        <Block title="Third-party services, only when you use them">
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <strong className="text-white">GIF</strong>: the GIF picker queries Google's Tenor API (United States) from your browser; it receives
              your search and your IP address.
            </li>
            <li>
              <strong className="text-white">Translation</strong>: only possible for an unencrypted message (bot, webhook); its text is sent, from
              the server, to the MyMemory service (Translated srl, Italy). Your IP address is not transmitted.
            </li>
            <li>
              <strong className="text-white">Push notifications</strong>: if you allow them, notifications go through your browser's push service
              (Google, Mozilla, Apple…), end-to-end encrypted between this server and your browser.
            </li>
            <li>
              <strong className="text-white">Discord import</strong>: if you import an archive, the server downloads it from ForgeArchive
              (forgearchive.heiphaistos.org, same publisher).
            </li>
          </ul>
          <p>No font is loaded from a third-party service.</p>
        </Block>
        <Block title="Retention periods">
          <ul className="list-disc pl-5 space-y-2">
            <li>Account, messages, files: until they are deleted (see above).</li>
            <li>
              Old clear text of private messages and groups, never re-encrypted by its author: 30 days after encryption went live. That of server
              channels is never erased (it is re-encrypted).
            </li>
            <li>Sessions: until sign-out, or 30 days without activity.</li>
            <li>Unconfirmed sign-ups and password reset links: until they expire (30 minutes for a link).</li>
            <li>Phones registered for notifications: 60 days without activity.</li>
            <li>Server audit logs: 90 days.</li>
            <li>Reports handled or rejected: 90 days; pending ones remain until they are handled.</li>
            <li>Error reports: 14 days after their last occurrence.</li>
            <li>Anti-abuse counters: 1 hour at most, in memory only.</li>
          </ul>
          <p>These deletions are automatic and checked every hour.</p>
        </Block>
        <Block title="Cookies and local storage">
          <p>
            ForgeChat sets two <strong className="text-white">strictly necessary</strong> cookies (HttpOnly) that keep you signed in: the access token
            (24 h) and the refresh token (30 days). Your browser's local storage keeps these tokens and your display and audio preferences (theme,
            zoom, chosen microphone and speaker, last channel opened, server folders…). No advertising or audience-measurement tracker: no consent
            is therefore requested.
          </p>
        </Block>
        <Block title="Recipients">
          <p>
            The data is hosted by IONOS SE in the European Union. The content you post is visible to the members of the servers and conversations
            concerned. The data is neither sold, nor transferred, nor used for profiling or advertising.
          </p>
        </Block>
        <Block title="Your rights">
          <p>
            You have the rights of access, rectification, erasure, restriction, objection and portability (articles 15 to 22 of the GDPR). You can
            export your data and delete your account from the settings, or write to <Mail /> — reply within one month.
          </p>
          <p>If you disagree, you can lodge a complaint with the CNIL (French data protection authority): <Ext href="https://www.cnil.fr">cnil.fr</Ext>.</p>
        </Block>
      </>
    ),
  },
  terms: {
    title: 'Terms of use',
    intro: (
      <p>
        These general terms of use (“Terms”) apply to the ForgeChat service (forgechat.heiphaistos.org and desktop applications). They are
        accepted when the account is created.
      </p>
    ),
    body: (
      <>
        <Block title="Purpose">
          <p>ForgeChat is a community messaging service: servers, channels, private messages, voice and video calls, file sharing.</p>
        </Block>
        <Block title="Free of charge">
          <p>The service is free, with no subscription, no in-app purchase and no advertising.</p>
        </Block>
        <Block title="Account">
          <p>
            You must be at least 15 years old, or have a parent's consent, to create an account. You provide a valid email address and keep your
            password secret; you are responsible for the activity on your account. You can delete it at any time from the settings.
          </p>
        </Block>
        <Block title="Content and behaviour">
          <p>
            You are responsible for the content you post. The following are prohibited: unlawful content (hate, harassment, threats, glorification of
            terrorism, child sexual abuse material, invasion of privacy or copyright infringement), spam, malware, identity theft, as well as any
            attempt to undermine the security or availability of the service.
          </p>
          <p>
            Each server is moderated by its owner and the roles they designate, who may add their own rules. The publisher may remove content,
            suspend or delete an account or a server that breaches these terms, and cooperates with the authorities upon legal request.
          </p>
        </Block>
        <Block title="Moderation of the instance">
          <p>
            The administrator may suspend or delete an account or a server that hosts unlawful content, or whose use is abusive, and enter a server
            under supervision (visible to its members) to handle a report. See the privacy policy.
          </p>
        </Block>
        <Block title="Reporting">
          <p>Any content can be reported with the “Report” feature or by email to <Mail />.</p>
        </Block>
        <Block title="Availability and liability">
          <p>
            The service is provided “as is”, with no guarantee of availability or of data retention: keep a copy of what matters. The publisher may
            modify, suspend or discontinue it at any time, and cannot be held liable for any direct or indirect damage resulting from its use or
            from content posted by users.
          </p>
        </Block>
        <Block title="Changes to the terms">
          <p>These terms may change; the date of the last update appears at the top of the page. Continuing to use the service constitutes acceptance.</p>
        </Block>
        <Block title="Governing law">
          <p>These terms are governed by French law. In the event of a dispute, an amicable solution will be sought before any legal action.</p>
        </Block>
        <Block title="Contact">
          <p><Mail /></p>
        </Block>
      </>
    ),
  },
}
