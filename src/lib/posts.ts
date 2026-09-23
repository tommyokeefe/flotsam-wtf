import { getCollection } from 'astro:content';
import type { CollectionEntry } from 'astro:content';

// Whether Drafts are readable in the environment being built.
//
// Deliberately fails closed: only the dev server and a Vercel preview
// deployment are allowed to include Drafts, and *everything else* — a local
// `npm run build`, CI, a future host that doesn't set VERCEL_ENV — is treated
// as production. Writing this the other way round (`VERCEL_ENV !== 'production'`)
// reads as equivalent and is not: an unset variable would then mean "show the
// Drafts", so the first build anywhere outside Vercel would publish them. The
// two failure modes aren't symmetric — one is an annoyance, the other is silent
// and permanent. See ADR 0004.
const draftsAreReadable =
	import.meta.env.DEV || process.env.VERCEL_ENV === 'preview';

/**
 * A Post's path on the site, without a trailing slash. Also the key a Document
 * is matched to its Post by (ADR 0008): the manifest publishes it as the
 * Document's `path`, and the page finds its Document by it, so both read it
 * from here.
 */
export function postPath(post: CollectionEntry<'posts'>): string {
	return `/posts/${post.id}`;
}

/**
 * The Posts that exist in this environment, newest first: every published Post,
 * plus Drafts when `draftsAreReadable`.
 *
 * Every Post lookup goes through here — the index, the post routes, and any
 * listing added later — so that a call site can't forget the Draft rule and
 * publish something by omission. Same reason `formatPostDate` is centralized in
 * ./date.ts.
 */
export async function getVisiblePosts(): Promise<CollectionEntry<'posts'>[]> {
	const posts = await getCollection('posts');
	return posts
		.filter((post) => draftsAreReadable || !post.data.draft)
		.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}
