// @ts-check
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  site: 'https://storyaconsulting.com',
  integrations: [],
  compressHTML: true,

  build: {
    inlineStylesheets: 'always',
  },

  adapter: cloudflare(),
});