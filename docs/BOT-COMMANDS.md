# Commandes slash et bots externes

Contrat entre le serveur ForgeChat et un bot (ex. l'adaptateur HeiphaisBot). Tout ce qui suit est
vérifié côté serveur ; un client modifié n'obtient jamais plus de droits.

## 1. Vue d'ensemble

```
Membre tape "/commande args"  ->  POST /servers/:id/channels/:id/messages (en clair)
  serveur : commande trouvée ? droits de l'appelant ? limite de débit ?
    native  -> exécutée par ForgeChat (ForgeBot)
    bot     -> POST signé vers callback_url du bot
  le message "/commande …" est retiré du salon ; la réponse arrive :
    - en réponse immédiate du POST (corps JSON), ou
    - plus tard via POST /api/bot/interactions/:interaction_id/reply
```

Un bot ne reçoit RIEN par WebSocket. Il reçoit un POST HTTPS sur son URL de rappel.

Les commandes intégrées (ForgeBot) sont déclarées dans le code (`server/src/handlers/commands/native.rs`) :
modération (`kick ban tempban unban timeout untimeout purge slowmode lock unlock roleadd roleremove warn
warnings nick`), utilitaires (`help ping serverinfo userinfo avatar poll`), fun (`roll coinflip choose 8ball
quote`). Un bot ne peut pas enregistrer ces noms, ni ceux du composeur des clients
(`me shrug tableflip unflip lenny clap spoiler giphy`).

## 2. Authentification du bot

`Authorization: Bot <jeton>` (jeton affiché une seule fois à la création du bot, régénérable).
`:bot_id` dans `/api/bots/:bot_id/...` est l'identifiant de JETON (`token_id` renvoyé par
`GET /servers/:id/bots`), pas l'id utilisateur du bot.

Erreurs : `401` jeton inconnu (30 échecs par IP / 15 min, puis `429`), `429` limite d'enregistrement
(30 requêtes / min / bot), `400` validation (message lisible dans `{"error": "..."}`).

## 3. Enregistrer les commandes

### Une commande : `POST /api/bots/:bot_id/commands`

Rétro-compatible : `{name, description}` suffit.

### En lot : `POST /api/bots/:bot_id/commands/batch` (corps 512 Ko max)

```json
{
  "replace": true,
  "callback_url": "https://bot.example.com/forgechat",
  "commands": [
    {
      "name": "meme",
      "description": "Envoie un meme",
      "category": "fun",
      "required_permission": "everyone",
      "dangerous": false,
      "options": [
        {"name": "theme", "description": "Thème", "type": "string", "required": false,
         "choices": [{"name": "Chats", "value": "cats"}]}
      ]
    }
  ]
}
```

Réponse : `{"ok": true, "registered": 1, "removed": 0}`. Tout ou rien : une seule commande invalide
refuse le lot (rien n'est enregistré). `replace: true` supprime les commandes du bot absentes de la liste.
`callback_url` (facultatif) règle l'URL de rappel dans la même transaction.

Règles :

| Champ | Règle |
|---|---|
| `name` | 1-32 caractères `a-z 0-9 _ -` (mis en minuscules), unique dans le lot, hors noms réservés |
| `description` | 1-100 caractères |
| `category` | 1-32 `a-z 0-9 _ -`, défaut `general` |
| `required_permission` | `everyone` (défaut), `owner`, un nom de permission (`KICK_MEMBERS`, `MANAGE_SERVER`, `BAN_MEMBERS`, `MANAGE_MESSAGES`, `MANAGE_ROLES`, `MANAGE_CHANNELS`…), ou plusieurs séparés par `|` (l'une OU l'autre) |
| `dangerous` | booléen, défaut `false` : les actions dangereuses sont journalisées (`COMMAND_USE`) et marquées en rouge dans l'interface |
| `options` | 25 max, noms uniques `a-z 0-9 _ -`, obligatoires AVANT facultatives |
| option `type` | `string` (défaut), `integer`, `boolean`, `user`, `role` |
| option `choices` | 25 max, `string` ou `integer` seulement ; `{name, value}` (100 caractères max) |
| `callback_url` | HTTPS, 500 caractères max, sans identifiants, hôte public (refus des IP privées/locales) |

Un administrateur (MANAGE_SERVER) peut aussi régler l'URL : `PUT /servers/:id/bots/:bot_user_id/callback`
`{"callback_url": "https://..." | null}`, ou la donner à la création (`POST /servers/:id/bots`).

## 4. Qui peut lancer quoi

Calculé par le serveur À CHAQUE exécution :

1. la commande existe pour CE serveur (bot toujours membre) ;
2. elle n'est pas désactivée par un administrateur ;
3. l'appelant remplit `required_permission` (le propriétaire et les administrateurs remplissent tout
   sauf `owner`, réservé au propriétaire) ;
4. si un administrateur a limité la commande à des rôles, l'appelant a l'un d'eux (propriétaire et
   administrateurs passent) ;
5. limite de débit : 15 commandes / 30 s par utilisateur et serveur.

Les exceptions par serveur (`PUT /servers/:id/commands/:name/override`, MANAGE_SERVER) ne peuvent que
RESTREINDRE (désactiver, relever la permission, limiter à des rôles) ou ouvrir une commande de BOT que
le bot avait réservée. Elles n'accordent jamais un droit que la route REST sous-jacente refuserait.

`GET /servers/:id/commands` (tout membre) renvoie, pour chaque commande : `name, description, category,
dangerous, native, options, bot_name, bot_username, bot_avatar, default_permission, required_permission,
enabled, allowed_role_ids, allowed` (`allowed` = ce que l'appelant peut lancer). Les commandes natives ont
`bot_name: "ForgeBot"`.

## 5. Appel du bot

`POST <callback_url>`, `Content-Type: application/json`, délai 4 s (connexion 2 s), aucune redirection suivie.

En-têtes :

```
X-ForgeChat-Timestamp: 1760000000            (secondes Unix)
X-ForgeChat-Signature: sha256=<hex>
```

Signature : `hex( HMAC-SHA256( clé, "<timestamp>" + "." + <corps brut> ) )`, avec

```
clé = base64_standard( SHA-256( jeton_du_bot ) )      // chaîne ASCII de 44 caractères, '=' compris
```

(c'est la valeur stockée côté serveur ; le jeton brut n'est jamais conservé). Le bot DOIT recalculer la
signature sur le corps brut, comparer en temps constant et rejeter un horodatage éloigné de plus de 5 minutes.

Exemple Node.js :

```js
const key = crypto.createHash('sha256').update(TOKEN).digest('base64');
const sig = 'sha256=' + crypto.createHmac('sha256', key).update(ts + '.' + rawBody).digest('hex');
```

Corps :

```json
{
  "version": 1,
  "interaction_id": "uuid",
  "command": "meme",
  "options": {"theme": "cats"},
  "args": "cats",
  "channel_id": "uuid",
  "server_id": "uuid",
  "user": {
    "id": "uuid",
    "username": "Momo",
    "role_ids": ["uuid"],
    "permissions": "9223372036854775807",
    "is_owner": true
  }
}
```

- `options` : uniquement celles fournies. `string` -> texte (la dernière option texte prend tout le reste de
  la ligne), `integer` -> nombre, `boolean` -> booléen, `user`/`role` -> UUID (déjà vérifié : membre de CE
  serveur / rôle de CE serveur, hors @everyone). Une option `choices` est ramenée à la `value` déclarée.
  Une erreur de saisie (option obligatoire manquante, mauvais type) est refusée par le serveur : le bot ne la voit pas.
- `args` : texte brut après le nom (jusqu'à ~500 caractères, une seule ligne).
- `user.permissions` : masque de bits ForgeChat en CHAÎNE décimale (le propriétaire/administrateur a
  `i64::MAX`, au-delà de 2^53). Les droits sont déjà contrôlés : le bot s'en sert pour ses propres règles fines.
- Le bot est responsable de la sécurité de ses propres actions ; ForgeChat n'exécute rien d'autre que ce
  que le bot renvoie comme message.

### Réponse immédiate (facultative)

Statut `2xx` et, si le bot répond tout de suite, un corps JSON de 16 Ko max :

```json
{"content": "Voici ton meme", "ephemeral": false}
```

Sans corps JSON valide ou sans `content`, rien n'est publié (le bot répondra plus tard). Un statut
non-2xx, un délai dépassé, une URL devenue non autorisée : l'appelant voit « Le bot n'a pas répondu à la commande. »

## 6. Répondre plus tard : `POST /api/bot/interactions/:interaction_id/reply`

`Authorization: Bot <jeton>` ; corps `{"content": "...", "ephemeral": false}`.

- `content` : 1-2000 caractères (4000 pour un éphémère).
- `ephemeral: true` : visible du seul appelant (évènement WS `COMMAND_RESPONSE`, rien n'est stocké).
- `ephemeral: false` : message public du bot dans le salon d'origine, avec les contrôles d'un message de bot
  ordinaire (salon visible, droit d'écrire, anti-spam, AutoMod).
- Limites : 5 réponses par interaction, 15 minutes, uniquement par le bot de l'interaction (`400` sinon).

Les messages libres restent possibles avec `POST /api/bot/messages` (inchangé).

## 7. Évènement reçu par l'appelant (clients)

```json
{"type": "COMMAND_RESPONSE", "server_id": "...", "channel_id": "...", "command": "meme",
 "content": "...", "ephemeral": true, "interaction_id": "uuid|null"}
```

Envoyé au seul appelant (toutes ses sessions) : réponses éphémères, erreurs (permission refusée, usage,
commande désactivée), avertissements reçus.

## 8. Journal d'audit

`COMMAND_USE` (commande `dangerous` autorisée, avec les 200 premiers caractères des arguments),
`COMMAND_DENIED` (commande `dangerous` refusée), `COMMAND_OVERRIDE` (exception créée/modifiée/retirée),
`BOT_CALLBACK_SET`, plus les évènements des routes réutilisées (`MEMBER_KICK`, `MEMBER_BAN`,
`MEMBER_UNBAN`, `MESSAGE_PURGE`, `MEMBER_WARN`, `MEMBER_NICKNAME_CHANGE`…).

## 9. Points d'attention pour l'adaptateur

- Les clients envoient la commande EN CLAIR (les salons sont chiffrés de bout en bout, une commande doit être
  lisible par le serveur) ; seul le message « /commande … » est concerné.
- Une commande de bot sans `callback_url` retombe sur l'ancien évènement WS `SLASH_COMMAND` (aucun bot ne le
  reçoit) et le message reste visible : configurer l'URL est obligatoire.
- `replace: true` à chaque démarrage de l'adaptateur garde la liste synchronisée sans doublon.
- Les noms de commandes sont uniques par serveur ; si deux bots déclarent le même nom, le plus ancien gagne.
- Marquer `dangerous: true` + `required_permission` adapté toute commande destructrice ; un serveur peut
  encore la désactiver ou la limiter à des rôles.
- Tant que `ephemeral` n'est pas demandé, la réponse est publique : ne jamais y mettre de données privées.
