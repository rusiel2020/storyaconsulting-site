# storyaconsulting-site

[storyaconsulting.com](https://storyaconsulting.com). Astro, plain CSS, no JS frameworks.

Pages: `/` (home), `/start` (five-question form), `/start/thanks`, `/privacy`. Shared layout in `src/layouts/Base.astro`, styles in `src/styles/site.css`. A light and dark switch sits in the header and remembers the visitor's choice.

## Develop

```bash
npm install
npm run dev      # localhost:4321
npm run build    # outputs dist/
npm test         # form handler tests, run against a mock SMTP server
```

## The Start form

`/start` posts to `/api/start`, a Cloudflare Worker (`worker/`). It checks the answers, then emails them to `paolo@storyaconsulting.com` through the Zoho Mail mailbox over SMTP. Nothing is stored anywhere else.

- `worker/index.js` routes `/api/*` to the Worker and everything else to the static files.
- `worker/handler.js` validates the form and builds the email.
- `worker/smtp.js` is the SMTP client.

Settings in `wrangler.jsonc`: `MAIL_TO`, `SMTP_HOST` (`smtp.zoho.com`, the US data centre), `SMTP_PORT` (465).

Two **secrets** must be set in Cloudflare (Workers & Pages, storyaconsulting-site, Settings, Variables and Secrets). They are not in the repo:

| Name | Value |
|---|---|
| `SMTP_USER` | `paolo@storyaconsulting.com` |
| `SMTP_PASS` | a Zoho **app password** (Zoho Accounts, Security, App Passwords), not the login password |

Until they are set, the form shows "We couldn't send your answers. Please email paolo@storyaconsulting.com instead." and the home page works as normal.

To try the Worker locally, put the same two names in a `.dev.vars` file (git-ignored).

## Deploy

Cloudflare Workers Builds, connected to this repo. Pushing to `main` builds `npm run build` and deploys `dist/` plus the Worker.
