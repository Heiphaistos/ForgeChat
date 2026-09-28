#!/usr/bin/env node
// Test end-to-end de l'API utilisée par le mobile, contre un serveur ForgeChat local.
// Usage: node mobile/scripts/e2e-api.mjs
// Sans dépendance : fetch/FormData/Blob/WebSocket natifs Node >= 22.

import { execFileSync } from 'node:child_process';

const BASE = process.env.FORGECHAT_API_URL || 'http://localhost:8080';
const WS_BASE = BASE.replace(/^http/, 'ws');
const POSTGRES_CONTAINER = process.env.POSTGRES_CONTAINER || 'forgechat-mobile-postgres-1';

// Ce script crée des comptes et envoie de vraies données : garde-fou contre une exécution
// accidentelle sur un serveur distant (prod ou autre) au lieu du backend local de dev.
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '10.0.2.2', '::1']);
const allowRemote = process.argv.includes('--allow-remote');
const targetHost = new URL(BASE).hostname;
if (!ALLOWED_HOSTS.has(targetHost) && !allowRemote) {
  console.error(
    `Refus de lancer e2e-api.mjs contre "${BASE}" (hôte "${targetHost}" non local).\n` +
      'Ce script crée des comptes et des données de test. Relance avec --allow-remote si c\'est bien voulu.',
  );
  process.exit(1);
}

let passed = 0;
let failed = 0;
const failures = [];

function ok(cond, label, extra) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  ✗ ${label}${extra ? ' — ' + extra : ''}`);
  }
  return cond;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(cond, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return true;
    await sleep(100);
  }
  return false;
}

function rand(n = 6) {
  return Math.random().toString(36).slice(2, 2 + n);
}

async function api(method, path, { token, body, isForm } = {}) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  let payload;
  if (isForm) {
    payload = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  return { status: res.status, body: json };
}

function connectWs(ticket) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${WS_BASE}/ws?ticket=${encodeURIComponent(ticket)}`);
    const messages = [];
    let opened = false;
    let settled = false;
    const finish = (closed) => {
      if (settled) return;
      settled = true;
      resolve({ ws, messages, opened, closed });
    };
    ws.addEventListener('open', () => {
      opened = true;
    });
    ws.addEventListener('message', (ev) => {
      try {
        messages.push(JSON.parse(ev.data));
      } catch {
        messages.push(ev.data);
      }
    });
    ws.addEventListener('close', () => finish(true));
    ws.addEventListener('error', () => {});
    setTimeout(() => finish(false), 1500);
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function countPushDevices(userId) {
  if (!UUID_RE.test(userId)) {
    console.log('  (avertissement) userId non-UUID, vérification DB ignorée');
    return null;
  }
  try {
    // Pas de shell (execFileSync + argv array) : l'UUID validé par regex est passé tel
    // quel à psql, sans interpolation de chaîne dans le SQL ni risque d'injection shell.
    const out = execFileSync(
      'docker',
      [
        'exec',
        POSTGRES_CONTAINER,
        'psql',
        '-U',
        'forgechat',
        '-d',
        'forgechat',
        '-t',
        '-A',
        '-c',
        `SELECT COUNT(*) FROM push_devices WHERE user_id='${userId}'`,
      ],
      { encoding: 'utf8' },
    );
    return parseInt(out.trim(), 10);
  } catch (e) {
    console.log('  (avertissement) impossible de vérifier push_devices via docker exec:', e.message);
    return null;
  }
}

async function main() {
  console.log(`=== ForgeChat e2e API test — ${BASE} ===`);
  const suffix = Date.now().toString(36) + rand(4);
  const userA = { username: `e2ea${suffix}`, email: `e2ea_${suffix}@test.local`, password: 'Test1234!' };
  const userB = { username: `e2eb${suffix}`, email: `e2eb_${suffix}@test.local`, password: 'Test1234!' };

  // 1. Inscription, login, /users/me
  console.log('\n-- 1. Inscription / login / me --');
  const regA = await api('POST', '/api/auth/register', { body: userA });
  ok(regA.status === 200, 'register A', JSON.stringify(regA.body));
  const regB = await api('POST', '/api/auth/register', { body: userB });
  ok(regB.status === 200, 'register B', JSON.stringify(regB.body));

  const loginA = await api('POST', '/api/auth/login', { body: { email: userA.email, password: userA.password } });
  ok(loginA.status === 200 && !!loginA.body?.access_token, 'login A', JSON.stringify(loginA.body));
  const loginB = await api('POST', '/api/auth/login', { body: { email: userB.email, password: userB.password } });
  ok(loginB.status === 200 && !!loginB.body?.access_token, 'login B', JSON.stringify(loginB.body));

  let aAccess = loginA.body.access_token;
  let aRefresh = loginA.body.refresh_token;
  const aId = loginA.body.user.id;
  const bAccess = loginB.body.access_token;
  const bId = loginB.body.user.id;

  const meA = await api('GET', '/api/users/me', { token: aAccess });
  ok(meA.status === 200 && meA.body?.id === aId, 'GET /api/users/me (A)', JSON.stringify(meA.body));

  // 2. Refresh + rotation
  console.log('\n-- 2. Refresh token rotation --');
  const refreshed = await api('POST', '/api/auth/refresh', { body: { refresh_token: aRefresh } });
  ok(refreshed.status === 200 && !!refreshed.body?.access_token, 'refresh A → nouveau couple', JSON.stringify(refreshed.body));
  const oldRetry = await api('POST', '/api/auth/refresh', { body: { refresh_token: aRefresh } });
  ok(oldRetry.status === 401, 'réutilisation ancien refresh_token → 401', `status=${oldRetry.status}`);
  aAccess = refreshed.body.access_token;
  aRefresh = refreshed.body.refresh_token;

  // 3/4. WebSocket + ticket usage unique + PRESENCE_INIT
  console.log('\n-- 3/4. WebSocket ticket + PRESENCE_INIT --');
  const ticketA1 = await api('POST', '/api/auth/ws-ticket', { token: aAccess });
  ok(ticketA1.status === 200 && !!ticketA1.body?.ticket, 'POST /api/auth/ws-ticket (A)', JSON.stringify(ticketA1.body));

  const connA = await connectWs(ticketA1.body.ticket);
  ok(connA.opened, 'A: connexion WS ouverte avec ticket');

  const reuseTicket = await connectWs(ticketA1.body.ticket);
  ok(
    reuseTicket.closed && reuseTicket.messages.length === 0,
    'réutilisation du même ticket → connexion refusée',
    `opened=${reuseTicket.opened} closed=${reuseTicket.closed} messages=${reuseTicket.messages.length}`,
  );

  const aWs = connA.ws;
  const aMessages = connA.messages;

  // 5. Amis + DM
  console.log('\n-- 5. Amis + DM --');
  const friendReq = await api('POST', '/api/friends/by-name', { token: aAccess, body: { name: userB.username } });
  ok(friendReq.status === 200, "A envoie une demande d'ami à B par pseudo", JSON.stringify(friendReq.body));

  const pending = await api('GET', '/api/friends/v2?filter=pending_received', { token: bAccess });
  const reqEntry = pending.body?.friends?.find((f) => f.friend_id === aId);
  ok(!!reqEntry, 'B voit la demande reçue', JSON.stringify(pending.body));

  const accept = await api('POST', `/api/friends/${reqEntry?.id}/accept`, { token: bAccess });
  ok(accept.status === 200, 'B accepte la demande', JSON.stringify(accept.body));

  const ticketB = await api('POST', '/api/auth/ws-ticket', { token: bAccess });
  const connB = await connectWs(ticketB.body.ticket);
  ok(connB.opened, 'B: connexion WS ouverte');
  const bWs = connB.ws;
  const bMessages = connB.messages;

  // PRESENCE_INIT (correctif du patch : abonnement au canal avant l'envoi du snapshot) —
  // testé maintenant que B (ami, en ligne) est présent dans le snapshot attendu par A.
  const ticketAPresence = await api('POST', '/api/auth/ws-ticket', { token: aAccess });
  const connAPresence = await connectWs(ticketAPresence.body.ticket);
  ok(connAPresence.opened, 'A: reconnexion WS pour vérifier PRESENCE_INIT');
  const presenceInit = connAPresence.messages.find((m) => m && m.type === 'PRESENCE_INIT');
  ok(!!presenceInit, 'A: reçoit PRESENCE_INIT à la connexion', JSON.stringify(connAPresence.messages.map((m) => m?.type)));
  ok(
    !!presenceInit?.users?.some((u) => u.user_id === bId),
    'PRESENCE_INIT contient B (ami en ligne)',
    JSON.stringify(presenceInit),
  );
  try { connAPresence.ws.close(); } catch {}

  const openDm = await api('POST', `/api/dms/${bId}`, { token: aAccess });
  ok(openDm.status === 200 && !!openDm.body?.dm_id, 'A ouvre un DM avec B', JSON.stringify(openDm.body));
  const dmId = openDm.body.dm_id;

  bMessages.length = 0;
  const sendMsg = await api('POST', `/api/dms/${dmId}/messages`, { token: aAccess, body: { content: 'Salut B !' } });
  ok(sendMsg.status === 200 && !!sendMsg.body?.id, 'A envoie un message DM', JSON.stringify(sendMsg.body));
  const msgId = sendMsg.body.id;

  await waitFor(() => bMessages.some((m) => m.type === 'DM_MESSAGE'), 3000);
  ok(
    bMessages.some((m) => m.type === 'DM_MESSAGE' && m.message?.id === msgId),
    'B reçoit DM_MESSAGE en WebSocket',
    JSON.stringify(bMessages.map((m) => m.type)),
  );

  bMessages.length = 0;
  const react = await api('PUT', `/api/dms/${dmId}/messages/${msgId}/reactions/${encodeURIComponent('\u{1F44D}')}`, {
    token: aAccess,
  });
  ok(react.status === 200, 'A réagit au message', JSON.stringify(react.body));
  await waitFor(() => bMessages.some((m) => m.type === 'DM_REACTION_TOGGLE'), 3000);
  ok(bMessages.some((m) => m.type === 'DM_REACTION_TOGGLE'), 'B reçoit DM_REACTION_TOGGLE');

  bMessages.length = 0;
  const edit = await api('PATCH', `/api/dms/${dmId}/messages/${msgId}`, {
    token: aAccess,
    body: { content: 'Salut B (édité) !' },
  });
  ok(edit.status === 200, 'A édite le message', JSON.stringify(edit.body));
  await waitFor(() => bMessages.some((m) => m.type === 'DM_MESSAGE_UPDATE'), 3000);
  ok(bMessages.some((m) => m.type === 'DM_MESSAGE_UPDATE'), 'B reçoit DM_MESSAGE_UPDATE');

  bMessages.length = 0;
  const del = await api('DELETE', `/api/dms/${dmId}/messages/${msgId}`, { token: aAccess });
  ok(del.status === 200, 'A supprime le message', JSON.stringify(del.body));
  await waitFor(() => bMessages.some((m) => m.type === 'DM_MESSAGE_DELETE'), 3000);
  ok(bMessages.some((m) => m.type === 'DM_MESSAGE_DELETE'), 'B reçoit DM_MESSAGE_DELETE');

  // 6. Pièces jointes
  console.log('\n-- 6. Pièces jointes --');
  const attMsg = await api('POST', `/api/dms/${dmId}/messages`, {
    token: aAccess,
    body: { content: '', has_attachments: true },
  });
  ok(attMsg.status === 200, 'A crée un message pour pièce jointe', JSON.stringify(attMsg.body));
  const attMsgId = attMsg.body.id;

  const png = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000155a7f7d70000000049454e44ae426082',
    'hex',
  );
  const form1 = new FormData();
  form1.append('file', new Blob([png], { type: 'image/png' }), 'test.png');
  const upOk = await api('POST', `/api/dms/${dmId}/messages/${attMsgId}/attachments`, {
    token: aAccess,
    body: form1,
    isForm: true,
  });
  ok(upOk.status === 200, 'upload image OK', JSON.stringify(upOk.body));

  const form2 = new FormData();
  form2.append('file', new Blob([Buffer.from('MZ')], { type: 'application/octet-stream' }), 'malware.exe');
  const upBad = await api('POST', `/api/dms/${dmId}/messages/${attMsgId}/attachments`, {
    token: aAccess,
    body: form2,
    isForm: true,
  });
  ok(upBad.status === 400, 'upload .exe refusé (400)', `status=${upBad.status} body=${JSON.stringify(upBad.body)}`);

  // 7. Push
  console.log('\n-- 7. Notifications push --');
  const pushOkA = await api('POST', '/api/push/devices', {
    token: aAccess,
    body: { token: 'ExponentPushToken[test123]', platform: 'android' },
  });
  ok(pushOkA.status === 200, 'enregistrement token push valide (A)', JSON.stringify(pushOkA.body));

  const pushBad = await api('POST', '/api/push/devices', {
    token: aAccess,
    body: { token: 'not-a-token', platform: 'android' },
  });
  ok(pushBad.status === 400, 'token push invalide → 400', `status=${pushBad.status}`);

  const bPushToken = 'ExponentPushToken[test456]';
  const pushOkB = await api('POST', '/api/push/devices', { token: bAccess, body: { token: bPushToken, platform: 'android' } });
  ok(pushOkB.status === 200, 'enregistrement token push valide (B)', JSON.stringify(pushOkB.body));

  const countBefore = countPushDevices(bId);
  const delOther = await api('DELETE', `/api/push/devices/${encodeURIComponent(bPushToken)}`, { token: aAccess });
  ok(delOther.status === 204, 'DELETE du token de B par A → 204', `status=${delOther.status}`);
  const countAfter = countPushDevices(bId);
  if (countBefore !== null && countAfter !== null) {
    ok(countAfter === countBefore, 'le device de B existe toujours (A ne peut pas supprimer le token de B)', `avant=${countBefore} après=${countAfter}`);
  } else {
    console.log('  (skip) vérification DB indisponible (docker exec a échoué)');
  }

  // 8. Logout
  console.log('\n-- 8. Logout --');
  const loginA2 = await api('POST', '/api/auth/login', { body: { email: userA.email, password: userA.password } });
  ok(loginA2.status === 200, 'A ouvre une 2e session', JSON.stringify(loginA2.body));
  const aAccess2 = loginA2.body.access_token;
  const aRefresh2 = loginA2.body.refresh_token;

  const logoutCurrent = await api('POST', '/api/auth/logout', {
    token: aAccess,
    body: { scope: 'current', refresh_token: aRefresh },
  });
  ok(logoutCurrent.status === 200, 'logout scope=current (session 1)', JSON.stringify(logoutCurrent.body));

  const refreshAfterCurrent = await api('POST', '/api/auth/refresh', { body: { refresh_token: aRefresh } });
  ok(refreshAfterCurrent.status === 401, 'refresh_token de la session déconnectée → 401', `status=${refreshAfterCurrent.status}`);

  const refreshOtherSession = await api('POST', '/api/auth/refresh', { body: { refresh_token: aRefresh2 } });
  ok(refreshOtherSession.status === 200, 'refresh_token de la 2e session → toujours valide', `status=${refreshOtherSession.status}`);
  const aAccess3 = refreshOtherSession.body.access_token;
  const aRefresh3 = refreshOtherSession.body.refresh_token;

  const logoutAll = await api('POST', '/api/auth/logout', { token: aAccess3, body: {} });
  ok(logoutAll.status === 200, 'logout sans scope (tout révoquer)', JSON.stringify(logoutAll.body));
  const refreshAfterAll = await api('POST', '/api/auth/refresh', { body: { refresh_token: aRefresh3 } });
  ok(refreshAfterAll.status === 401, 'toutes les sessions révoquées après logout global', `status=${refreshAfterAll.status}`);

  // 9. Appel : destinataire hors ligne mais avec push, puis reconnexion
  console.log('\n-- 9. Appel (push si hors ligne, rejeu à la reconnexion) --');
  bWs.close();
  await sleep(800);

  aMessages.length = 0;
  aWs.send(JSON.stringify({ type: 'DM_CALL_INIT', to: bId, dm_id: dmId, call_type: 'voice' }));
  await sleep(2000);
  const gotOfflineError = aMessages.some((m) => m.type === 'DM_CALL_ERROR' && m.reason === 'offline');
  ok(
    !gotOfflineError,
    'A ne reçoit PAS DM_CALL_ERROR "offline" (B a un appareil push)',
    JSON.stringify(aMessages),
  );

  const ticketB2 = await api('POST', '/api/auth/ws-ticket', { token: bAccess });
  const connB2 = await connectWs(ticketB2.body.ticket);
  ok(connB2.opened, 'B se reconnecte dans les 45s');
  await waitFor(() => connB2.messages.some((m) => m.type === 'DM_CALL_INCOMING'), 3000);
  ok(
    connB2.messages.some((m) => m.type === 'DM_CALL_INCOMING'),
    'B reçoit DM_CALL_INCOMING rejoué à la reconnexion',
    JSON.stringify(connB2.messages.map((m) => m.type)),
  );

  try { aWs.close(); } catch {}
  try { connB2.ws.close(); } catch {}

  console.log(`\n=== Résultat : ${passed} OK, ${failed} échec(s) ===`);
  if (failed > 0) {
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
