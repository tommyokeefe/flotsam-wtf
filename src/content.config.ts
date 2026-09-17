import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
// `z` re-exported from 'astro:content' is deprecated and goes away in Astro 8.
import { z } from 'astro/zod';

// One folder per Post, each with an index.md/index.mdx and its colocated images.
// The pattern is deliberately strict: only a file named `index` is a Post, so a
// scratch file dropped into a post's folder is ignored rather than silently
// published at a URL nobody intended.
const posts = defineCollection({
	loader: glob({ pattern: '**/index.{md,mdx}', base: './src/content/posts' }),
	schema: z.object({
		title: z.string(),
		description: z.string().optional(),
		date: z.coerce.date(),
		// Omitted by normal posts. A Draft is readable outside production only;
		// see `getVisiblePosts` in src/lib/posts.ts and ADR 0004.
		draft: z.boolean().default(false),
		// `.strict()` so an unrecognized key fails the build instead of being
		// dropped. Zod's default is to strip silently, which made `draf: true`
		// publish a post that was meant to be held back — the one way draft
		// support failed without a word. See ADR 0005.
	}).strict(),
});

export const collections = { posts };
