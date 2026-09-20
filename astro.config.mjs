// @ts-check
import { defineConfig } from 'astro/config';

import mdx from '@astrojs/mdx';

// https://astro.build/config
export default defineConfig({
  // The host the site is actually served from: the apex redirects here (308),
  // so every og:url, absolute og:image and canonical derived from this should
  // name the address that answers, not one that bounces.
  site: 'https://www.flotsam.wtf',
  integrations: [mdx()],
  markdown: {
    syntaxHighlight: {
      type: 'shiki',
      excludeLangs: ['mermaid'],
    },
  },
});