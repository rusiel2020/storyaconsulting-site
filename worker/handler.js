// Handles the Start form. Kept free of Cloudflare-only imports so tests can run it in Node.
import { sendMail } from './smtp.js';

const DEFAULT_ORIGINS = ['https://storyaconsulting.com', 'https://www.storyaconsulting.com'];
const MAX_BODY_BYTES = 20000;

const Q1 = {
  agency: 'PR or communications agency',
  inhouse: 'In-house communications team (bank, asset manager, corporate)',
  publisher: 'Publisher or publishing services',
  other: 'Something else',
};
const Q2 = {
  none: "We haven't started",
  licences: 'We bought licences and few people use them',
  solo: 'A few people use it on their own',
  built: 'Someone senior built a tool that works, and now they maintain it',
  several: "Several tools run in the team's daily work",
};
const Q3 = {
  monitoring: 'Daily monitoring and briefings',
  coverage: 'Coverage reports',
  drafting: 'Drafting releases and Q&A',
  style: 'Style and house-rule checks',
  research: 'Research and account handover',
  other: 'Something else',
};
const Q4 = {
  people: 'People: habits, directors, nobody wanted it',
  quality: "The output wasn't good enough",
  confidentiality: 'Client confidentiality, or no clear rule on what can go in',
  it: 'IT or security blocked it',
  owner: 'Nobody owned it once it was live',
  untried: "We haven't tried anything yet",
};
const Q5 = {
  me: 'I do',
  directors: 'My directors or partners',
  hq: 'Regional or head office',
  unsure: 'Not sure',
};

const redirect = (request, path) => Response.redirect(new URL(path, request.url), 303);
const text = (form, key, max) => String(form.get(key) ?? '').replace(/\r/g, '').trim().slice(0, max);
const oneLine = (v) => v.replace(/\s+/g, ' ').trim();

export async function handleStart(request, env, { connect }) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  }

  const origin = request.headers.get('Origin');
  const allowed = env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()) : DEFAULT_ORIGINS;
  if (origin && !allowed.includes(origin)) return new Response('Forbidden', { status: 403 });

  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > MAX_BODY_BYTES) return redirect(request, '/start?error=missing');

  let form;
  try {
    form = await request.formData();
  } catch {
    return redirect(request, '/start?error=missing');
  }

  // Honeypot: real visitors never see or fill this field.
  if (form.get('website')) return redirect(request, '/start/thanks');

  const q1 = text(form, 'q1', 40);
  const q2 = text(form, 'q2', 40);
  const q4 = text(form, 'q4', 40);
  const q5 = text(form, 'q5', 40);
  const q3 = form.getAll('q3').map((v) => String(v)).filter((v) => v in Q3);
  const name = oneLine(text(form, 'name', 200));
  const email = oneLine(text(form, 'email', 254));
  const company = oneLine(text(form, 'company', 200));
  const role = oneLine(text(form, 'role', 200));
  const q4text = text(form, 'q4text', 2000);
  const dumb = text(form, 'dumb', 2000);

  const valid =
    q1 in Q1 && q2 in Q2 && q4 in Q4 && q5 in Q5 &&
    name && company && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!valid) return redirect(request, '/start?error=missing');

  if (!env.SMTP_USER || !env.SMTP_PASS) {
    console.error('Start form: SMTP_USER or SMTP_PASS is not set');
    return redirect(request, '/start?error=send');
  }

  const to = env.MAIL_TO || env.SMTP_USER;
  const body = [
    'New answers from the Start form',
    '',
    `Name: ${name}`,
    `Work email: ${email}`,
    `Company: ${company}`,
    `Role: ${role || '(not given)'}`,
    '',
    `1. Which best describes you: ${Q1[q1]}`,
    `2. Where they are with AI: ${Q2[q2]}`,
    `3. Work that eats the hours: ${q3.length ? q3.map((v) => Q3[v]).join('; ') : '(none chosen)'}`,
    `4. Why it didn't stick: ${Q4[q4]}`,
    `   In their words: ${q4text || '(nothing added)'}`,
    `5. Who decides: ${Q5[q5]}`,
    '',
    `A dumb question for the series: ${dumb || '(none)'}`,
    '',
    'Sent from storyaconsulting.com/start',
  ].join('\n');

  try {
    await sendMail({
      connect,
      host: env.SMTP_HOST || 'smtp.zoho.com',
      port: Number(env.SMTP_PORT || 465),
      secure: env.SMTP_SECURE !== 'false',
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
      from: env.SMTP_USER,
      to,
      subject: `Start form: ${company}`.slice(0, 120),
      text: body,
      replyTo: email,
    });
  } catch (err) {
    // Log the failure reason only: no answers, no personal details, no credentials.
    console.error('Start form: send failed:', err && err.message);
    return redirect(request, '/start?error=send');
  }

  return redirect(request, '/start/thanks');
}
