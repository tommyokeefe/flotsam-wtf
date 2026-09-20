import { getImage } from 'astro:assets';
import type { ImageMetadata } from 'astro';

// The dimensions a card is actually rendered at, so the tags can declare them
// and a scraper can lay the card out without fetching the file first.
export const SHARE_WIDTH = 1200;
export const SHARE_HEIGHT = 630;

/**
 * The image a Post is shared as: a generated derivative, not the author's file.
 *
 * Deliberately a derivative because the original may be any shape and many
 * megabytes, and `<Image>` would hand back WebP, which some scrapers still
 * refuse. A cropped JPEG at a fixed size is the one combination that renders
 * everywhere. See ADR 0006.
 *
 * Shared by the page's `og:image` and the Visible Post manifest so that both
 * point at the same built file: what a card shows and what gets federated as
 * the Post's cover can't drift apart.
 */
export function getShareImage(src: ImageMetadata) {
	return getImage({
		src,
		width: SHARE_WIDTH,
		height: SHARE_HEIGHT,
		fit: 'cover',
		format: 'jpeg',
	});
}
