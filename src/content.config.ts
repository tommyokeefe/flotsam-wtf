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
	// The `image` helper is why this is the function form: it resolves a path
	// relative to the post's own folder, fails the build if the file is missing,
	// and hands back real dimensions. See ADR 0006.
	schema: ({ image }) =>
		z
			.object({
				title: z.string(),
				description: z.string().optional(),
				date: z.coerce.date(),
				// Omitted by normal posts. A Draft is readable outside production
				// only; see `getVisiblePosts` in src/lib/posts.ts and ADR 0004.
				draft: z.boolean().default(false),
				// The share image, colocated with the post. One field, not two —
				// a post-list thumbnail is meant to reuse this exact image.
				image: image().optional(),
				imageAlt: z.string().optional(),
				// `.strict()` so an unrecognized key fails the build instead of
				// being dropped. Zod's default is to strip silently, which made
				// `draf: true` publish a post that was meant to be held back — the
				// one way draft support failed without a word. See ADR 0005.
			})
			.strict()
			// Alt text is required whenever there's an image to describe. Skipping
			// it costs nothing you can see and everything to someone using a
			// screen reader, so the build refuses rather than letting it pass.
			// See ADR 0006 before relaxing this.
			.refine((data) => !data.image || Boolean(data.imageAlt), {
				message:
					'`imageAlt` is required when `image` is set — describe the picture for anyone who meets this post as a shared card instead of a page.',
				path: ['imageAlt'],
			}),
});

export const collections = { posts };
