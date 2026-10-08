import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { Readable, Writable } from 'node:stream';
import { handleStart } from '../worker/handler.js';

// A tiny SMTP server that records what it is sent.
let server, port, mails, creds, failAuth;

function startServer() {
  return new Promise((resolve) => {
    server = net.createServer((sock) => {
      let buf = '';
      let state = 'cmd';
      let data = '';
      let authStep = 0;
      let current = { from: null, to: null };
      sock.write('220 mock ready\r\n');
      sock.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        for (;;) {
          if (state === 'data') {
            const end = buf.indexOf('\r\n.\r\n');
            if (end < 0) return;
            data = buf.slice(0, end);
            buf = buf.slice(end + 5);
            mails.push({ from: current.from, to: current.to, raw: data });
            state = 'cmd';
            sock.write('250 queued\r\n');
            continue;
          }
          const i = buf.indexOf('\r\n');
          if (i < 0) return;
          const line = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (authStep === 1) { creds.user = Buffer.from(line, 'base64').toString(); authStep = 2; sock.write('334 UGFzc3dvcmQ6\r\n'); continue; }
          if (authStep === 2) {
            creds.pass = Buffer.from(line, 'base64').toString();
            authStep = 0;
            sock.write(failAuth ? '535 authentication failed\r\n' : '235 ok\r\n');
            continue;
          }
          if (line.startsWith('EHLO')) sock.write('250-mock\r\n250 AUTH LOGIN\r\n');
          else if (line === 'AUTH LOGIN') { authStep = 1; sock.write('334 VXNlcm5hbWU6\r\n'); }
          else if (line.startsWith('MAIL FROM:')) { current.from = line.slice(10); sock.write('250 ok\r\n'); }
          else if (line.startsWith('RCPT TO:')) { current.to = line.slice(8); sock.write('250 ok\r\n'); }
          else if (line === 'DATA') { state = 'data'; sock.write('354 go\r\n'); }
          else if (line === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
          else sock.write('500 unknown\r\n');
        }
      });
    });
    server.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
  });
}

// Stand-in for cloudflare:sockets connect(), over plain TCP to the mock.
const connect = (addr) => {
  const s = net.connect(addr.port, addr.hostname);
  return { readable: Readable.toWeb(s), writable: Writable.toWeb(s), close: () => s.destroy() };
};

const env = () => ({
  SMTP_USER: 'paolo@storyaconsulting.com',
  SMTP_PASS: 'app-password-123',
  MAIL_TO: 'paolo@storyaconsulting.com',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: String(port),
  SMTP_SECURE: 'false',
});

const valid = () => ({
  q1: 'agency', q2: 'built', q4: 'people', q5: 'directors',
  name: 'Ada Lovelace', email: 'ada@example.com', company: 'Example Comms',
});

function post(fields, { origin = 'https://storyaconsulting.com', extra = [] } = {}) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  for (const [k, v] of extra) body.append(k, v);
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (origin) headers.Origin = origin;
  return new Request('https://storyaconsulting.com/api/start', { method: 'POST', headers, body });
}

const decodeBody = (raw) => Buffer.from(raw.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');
const location = (res) => new URL(res.headers.get('location')).pathname + new URL(res.headers.get('location')).search;

before(startServer);
after(() => server.close());
beforeEach(() => { mails = []; creds = {}; failAuth = false; });

test('a valid submission is emailed to Paolo and redirects to thanks', async () => {
  const res = await handleStart(post({ ...valid(), role: 'Head of Comms', q4text: 'Directors never opened it' }, { extra: [['q3', 'monitoring'], ['q3', 'coverage']] }), env(), { connect });
  assert.equal(res.status, 303);
  assert.equal(location(res), '/start/thanks');
  assert.equal(mails.length, 1);
  assert.equal(creds.user, 'paolo@storyaconsulting.com');
  assert.equal(creds.pass, 'app-password-123');
  const m = mails[0];
  assert.equal(m.from, '<paolo@storyaconsulting.com>');
  assert.equal(m.to, '<paolo@storyaconsulting.com>');
  assert.match(m.raw, /Reply-To: ada@example\.com/);
  assert.match(m.raw, /Subject: Start form: Example Comms/);
  const body = decodeBody(m.raw);
  assert.match(body, /Name: Ada Lovelace/);
  assert.match(body, /Company: Example Comms/);
  assert.match(body, /Head of Comms/);
  assert.match(body, /Daily monitoring and briefings; Coverage reports/);
  assert.match(body, /Someone senior built a tool that works/);
  assert.match(body, /Directors never opened it/);
});

test('non-ASCII names and companies survive', async () => {
  const res = await handleStart(post({ ...valid(), name: 'José Zoë 北京', company: 'Café Média' }), env(), { connect });
  assert.equal(location(res), '/start/thanks');
  const m = mails[0];
  assert.match(m.raw, /Subject: =\?UTF-8\?B\?/);
  assert.match(decodeBody(m.raw), /Name: José Zoë 北京/);
});

test('missing required answers redirect back with an error and send nothing', async () => {
  const bad = valid();
  delete bad.q2;
  const res = await handleStart(post(bad), env(), { connect });
  assert.equal(location(res), '/start?error=missing');
  assert.equal(mails.length, 0);
});

test('an invalid email is rejected', async () => {
  const res = await handleStart(post({ ...valid(), email: 'not-an-email' }), env(), { connect });
  assert.equal(location(res), '/start?error=missing');
  assert.equal(mails.length, 0);
});

test('unknown answer values are rejected', async () => {
  const res = await handleStart(post({ ...valid(), q1: 'hacker' }), env(), { connect });
  assert.equal(location(res), '/start?error=missing');
  assert.equal(mails.length, 0);
});

test('a filled honeypot looks like success but sends nothing', async () => {
  const res = await handleStart(post({ ...valid(), website: 'http://spam.example' }), env(), { connect });
  assert.equal(location(res), '/start/thanks');
  assert.equal(mails.length, 0);
});

test('a foreign Origin is refused', async () => {
  const res = await handleStart(post(valid(), { origin: 'https://evil.example' }), env(), { connect });
  assert.equal(res.status, 403);
  assert.equal(mails.length, 0);
});

test('GET is not allowed', async () => {
  const res = await handleStart(new Request('https://storyaconsulting.com/api/start'), env(), { connect });
  assert.equal(res.status, 405);
});

test('header injection in the company field cannot add headers', async () => {
  const res = await handleStart(post({ ...valid(), company: 'Acme\r\nBcc: attacker@example.com' }), env(), { connect });
  assert.equal(location(res), '/start/thanks');
  assert.doesNotMatch(mails[0].raw.split('\r\n\r\n')[0], /^Bcc:/m);
});

test('an SMTP authentication failure redirects with a send error', async () => {
  failAuth = true;
  const res = await handleStart(post(valid()), env(), { connect });
  assert.equal(location(res), '/start?error=send');
  assert.equal(mails.length, 0);
});

test('missing credentials redirect with a send error without connecting', async () => {
  const e = env();
  delete e.SMTP_PASS;
  const res = await handleStart(post(valid()), e, { connect });
  assert.equal(location(res), '/start?error=send');
  assert.equal(mails.length, 0);
});
