// @ts-check
import { defineConfig } from 'astro/config';

import mdx from '@astrojs/mdx';
import { SITE_URL } from './src/lib/site.mjs';

// https://astro.build/config
export default defineConfig({
  // Lives in src/lib/site.mjs so the Publication and the pages can't disagree
  // about which host the site is on; see there for why it's www.
  site: SITE_URL,
  integrations: [mdx()],
  markdown: {
    syntaxHighlight: {
      type: 'shiki',
      excludeLangs: ['mermaid'],
    },
  },
});