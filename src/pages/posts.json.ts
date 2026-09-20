import type { APIRoute } from 'astro';
import { getVisiblePosts } from '../lib/posts';
import { getShareImage } from '../lib/share-image';

// Every Visible Post as JSON, for CI to publish from. Sourced from
// `getVisiblePosts()` and nothing else — a second Draft filter here would be a
// second owner of the rule (ADR 0004). `npm run audit:manifest` is the check
// that this stays true, and it deliberately doesn't share code with this file.
//
// Fields are only present when the Post has them, so a consumer can tell
// "no description" from an empty one.
export const GET: APIRoute = async ({ site }) => {
	const posts = await getVisiblePosts();

	const manifest = await Promise.all(
		posts.map(async (post) => {
			const path = `/posts/${post.id}`;
			return {
				title: post.data.title,
				path,
				canonicalUrl: new URL(path, site).href,
				publishedAt: post.data.date.toISOString(),
				...(post.data.description && { description: post.data.description }),
				// The generated JPEG, not the author's original: this is what gets
				// uploaded as the Post's cover image (ADR 0006).
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
