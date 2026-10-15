#!/usr/bin/env node
// Signature hors ligne des releases ForgeChat (Ed25519, node:crypto, aucune dépendance).
//
//   node scripts/release-sign.mjs keygen            crée la paire (refuse d'écraser)
//   node scripts/release-sign.mjs sign   <dossier>  signe <dossier>/SHA256SUMS.txt
//   node scripts/release-sign.mjs verify <dossier>  vérifie <dossier>/SHA256SUMS.txt.sig
//
// La signature est l'Ed25519 brute (64 octets, base64) des octets EXACTS de SHA256SUMS.txt.
// Procédure complète : docs/PUBLICATION-SIGNEE.md. La clé privée ne quitte jamais cette machine.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PRIVATE = process.env.FORGECHAT_SIGNING_KEY ?? 'D:\\MDP\\forgechat-release-signing\\private.pem';
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'deploy', 'release-signing-public.pem');
const LINE = /^([0-9a-f]{64}) [ *]([A-Za-z0-9._-]{1,120})$/;

function die(msg) {
  console.error('ERREUR : ' + msg);
  process.exit(1);
}

/** Lignes `<sha256>  <nom>` de SHA256SUMS.txt ; toute autre ligne non vide est une erreur. */
function parseSums(text) {
  const out = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = line.match(LINE);
    if (!m) die('ligne illisible dans SHA256SUMS.txt : ' + JSON.stringify(line));
    out.set(m[2], m[1]);
  }
  if (out.size === 0) die('SHA256SUMS.txt vide');
  return out;
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function rawPublicKey(key) {
  // SPKI Ed25519 = 12 octets d'en-tête + 32 octets de clé.
  return createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(12);
}

function keygen() {
  if (existsSync(PRIVATE)) die(PRIVATE + ' existe déjà : refus d’écraser la clé de signature');
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  mkdirSync(dirname(PRIVATE), { recursive: true });
  writeFileSync(PRIVATE, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600, flag: 'wx' });
  writeFileSync(PUBLIC, publicKey.export({ format: 'pem', type: 'spki' }));
  const raw = rawPublicKey(readFileSync(PUBLIC));
  console.log('Clé privée : ' + PRIVATE);
  console.log('Clé publique : ' + PUBLIC);
  console.log('Clé publique brute (base64) : ' + raw.toString('base64'));
  console.log('Empreinte SHA-256 de la clé publique : ' + createHash('sha256').update(raw).digest('hex'));
}

function signDir(dir) {
  const sumsPath = join(dir, 'SHA256SUMS.txt');
  const bytes = readFileSync(sumsPath);
  const sums = parseSums(bytes.toString('utf8'));
  for (const [name, expected] of sums) {
    const p = join(dir, name);
    if (!existsSync(p)) die(name + ' listé mais absent du dossier : télécharger TOUS les fichiers de la release');
    const got = sha256File(p);
    if (got !== expected) die(name + ' : empreinte locale ' + got + ' au lieu de ' + expected + ' : signature REFUSÉE');
    console.log('  ' + name + ' OK');
  }
  const sig = sign(null, bytes, createPrivateKey(readFileSync(PRIVATE)));
  if (!verify(null, bytes, createPublicKey(readFileSync(PUBLIC)), sig)) {
    die('la clé privée ne correspond pas à ' + basename(PUBLIC));
  }
  writeFileSync(sumsPath + '.sig', sig.toString('base64') + '\n');
  console.log('Signé : ' + sumsPath + '.sig (' + sums.size + ' fichiers)');
}

function verifyDir(dir) {
  const sumsPath = join(dir, 'SHA256SUMS.txt');
  const sig = Buffer.from(readFileSync(sumsPath + '.sig', 'utf8').trim(), 'base64');
  const ok = sig.length === 64 && verify(null, readFileSync(sumsPath), createPublicKey(readFileSync(PUBLIC)), sig);
  if (!ok) die('signature INVALIDE');
  console.log('Signature valide.');
}

const [cmd, dir] = process.argv.slice(2);
if (cmd === 'keygen') keygen();
else if (cmd === 'sign' && dir) signDir(dir);
else if (cmd === 'verify' && dir) verifyDir(dir);
else die('usage : release-sign.mjs keygen | sign <dossier> | verify <dossier>');
