// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://storyaconsulting.com',
  integrations: [],
  compressHTML: true,
  build: {
    inlineStylesheets: 'always',
  },
});
