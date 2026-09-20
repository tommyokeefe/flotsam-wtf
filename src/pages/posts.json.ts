import type { APIRoute } from 'astro';
import { getVisiblePosts } from '../lib/posts';
import { getShareImage } from '../lib/share-image';

// Every Visible Post as JSON, for CI to publish from. Sourced from
// `getVisiblePosts()` and nothing else — a second Draft filter here would be a
// second owner of the rule (ADR 0004). `npm run audit:manifest` is the check
// that this stays true, and it deliberately doesn't share code with this file.
//
// `description` and `image` are only present when the Post has them; an empty
// description counts as none, so there's never an empty string to handle.
export const GET: APIRoute = async ({ site }) => {
	const posts = await getVisiblePosts();

	const manifest = await Promise.all(
		posts.map(async (post) => {
			const path = `/posts/${post.id}`;
			return {
				title: post.data.title,
				path,
				// With the trailing slash, because that is the address the Post's own
				// page declares as `og:url` (Layout derives it from `Astro.url.pathname`,
				// which has one in a directory-format build). Informational only: a
				// Document has no canonical URL, so this is never written to one (a
				// reader joins the Publication's `url` and the Document's `path`).
				// `path` stays slash-less: it's the match key and what the site links to.
				canonicalUrl: new URL(`${path}/`, site).href,
				publishedAt: post.data.date.toISOString(),
				...(post.data.description && { description: post.data.description }),
				// The Share image as its generated JPEG, not the author's original
				// (ADR 0006): this is what gets uploaded as the Document's Standard.site
				// `coverImage`. A Post with no Share image gets no `image` here, even
				// though its page's og:image falls back to the site card — that
				// fallback is a sharing convenience, not part of the Post.
				...(post.data.image && {
					image: new URL((await getShareImage(post.data.image)).src, site).href,
				}),
			};
		}),
	);

	return new Response(JSON.stringify(manifest, null, 2) + '\n', {
		headers: { 'Content-Type': 'application/json' },
	});
};
