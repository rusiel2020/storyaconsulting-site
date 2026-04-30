# storyaconsulting-site

One-pager for [storyaconsulting.com](https://storyaconsulting.com).

Astro, plain CSS, no JS frameworks. Single page at `src/pages/index.astro`, styles inlined at build time, ~3KB hand-written JS for the numeral counter.

## Develop

```bash
npm install
npm run dev      # localhost:4321
npm run build    # outputs dist/
```

## Deploy

Cloudflare Pages, connected to this repo. Build command `npm run build`, output directory `dist/`.
