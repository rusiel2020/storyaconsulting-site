// Minimal SMTP client for a Cloudflare Worker (or Node, in tests).
// The socket opener is passed in, so the same code runs against
// `connect` from "cloudflare:sockets" in production and a TCP shim in tests.

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(str) {
  const bytes = enc.encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function wrap76(s) {
  return (s.match(/.{1,76}/g) || []).join('\r\n');
}

function oneLine(v) {
  return String(v).replace(/[\r\n]+/g, ' ').trim();
}

function encodeHeader(v) {
  const clean = oneLine(v);
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${b64(clean)}?=`;
}

export function buildMessage({ from, to, subject, text, replyTo, date = new Date() }) {
  const domain = from.split('@')[1] || 'localhost';
  const headers = [
    `From: ${oneLine(from)}`,
    `To: ${oneLine(to)}`,
    replyTo ? `Reply-To: ${oneLine(replyTo)}` : null,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ].filter(Boolean);
  // Base64 body: no line can start with "." so no dot-stuffing is needed.
  return headers.join('\r\n') + '\r\n\r\n' + wrap76(b64(text));
}

function lineReader(readable) {
  const reader = readable.getReader();
  let buf = '';
  async function readLine() {
    for (;;) {
      const i = buf.indexOf('\r\n');
      if (i >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        return line;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('SMTP connection closed early');
      buf += dec.decode(value, { stream: true });
    }
  }
  async function readReply() {
    const lines = [];
    for (;;) {
      const line = await readLine();
      lines.push(line);
      if (/^\d{3}( |$)/.test(line)) {
        return { code: parseInt(line.slice(0, 3), 10), text: lines.join('\n') };
      }
    }
  }
  return { readReply };
}

export async function sendMail({
  connect,
  host,
  port,
  secure = true,
  user,
  pass,
  from,
  to,
  subject,
  text,
  replyTo,
  timeoutMs = 15000,
  clientName = 'storyaconsulting.com',
}) {
  const socket = connect({ hostname: host, port }, { secureTransport: secure ? 'on' : 'off' });
  const writer = socket.writable.getWriter();
  const rd = lineReader(socket.readable);
  const send = (line) => writer.write(enc.encode(line + '\r\n'));
  const expect = async (codes, step) => {
    const r = await rd.readReply();
    if (!codes.includes(r.code)) throw new Error(`SMTP ${step} failed: ${r.text}`);
  };
  const message = buildMessage({ from, to, subject, text, replyTo });

  async function run() {
    await expect([220], 'greeting');
    await send(`EHLO ${clientName}`);
    await expect([250], 'EHLO');
    await send('AUTH LOGIN');
    await expect([334], 'AUTH');
    await send(b64(user));
    await expect([334], 'AUTH username');
    await send(b64(pass));
    await expect([235], 'AUTH password');
    await send(`MAIL FROM:<${from}>`);
    await expect([250], 'MAIL FROM');
    await send(`RCPT TO:<${to}>`);
    await expect([250, 251], 'RCPT TO');
    await send('DATA');
    await expect([354], 'DATA');
    await writer.write(enc.encode(message + '\r\n.\r\n'));
    await expect([250], 'message');
    await send('QUIT');
  }

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('SMTP timeout')), timeoutMs);
  });
  try {
    await Promise.race([run(), timeout]);
  } finally {
    clearTimeout(timer);
    try { await writer.close(); } catch {}
    try { socket.close?.(); } catch {}
  }
}
