// Commandes intégrées (ForgeBot), lues par le serveur lui-même : seules à partir en clair sans confirmation.
// Liste LOCALE (server/src/handlers/commands/native.rs, NATIVES) : un serveur ne peut pas en ajouter
// une en annonçant `native: true`. Un bot ne peut pas enregistrer ces noms (RESERVED côté serveur).
// À tenir à jour avec le serveur ; test : scripts/nativeCommands.test.mjs.
export const NATIVE_COMMANDS: ReadonlySet<string> = new Set([
  'kick', 'ban', 'tempban', 'unban', 'timeout', 'untimeout', 'purge', 'slowmode', 'lock', 'unlock',
  'roleadd', 'roleremove', 'warn', 'warnings', 'nick',
  'help', 'ping', 'serverinfo', 'userinfo', 'avatar', 'poll',
  'roll', 'coinflip', 'choose', '8ball', 'quote',
])
