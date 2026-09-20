// The decision half of publishing: given what the site says should exist (the
// manifest) and what does exist on the PDS, what to create, update and delete —
// or whether to refuse the whole thing.
//
// Everything destructive is decided here and nowhere else. The executor (#41) is
// a loop over a plan that has already been validated, so it can't be the place a
// bad delete slips through, and the dangerous logic can be tested by passing in
// two arrays. This performs no I/O and never mutates its arguments; anything
// that needs the network or the disk (like the image's CID) is done by the
// caller and passed in. See ADR 0008 for why the manifest is authoritative,
// deletions included, and ADR 0007 for why a Document carries no prose.
//
// A manifest entry is what the site emits at /posts.json — `title`, `path`,
// `canonicalUrl`, `publishedAt`, and `description` / `image` only when the Post
// has them — plus `imageCid`, the CID of that image's bytes, which the caller
// works out from the built file because the planner reads no files.
//
// An existing Document is what the PDS holds: its `uri`, `site`, `title`,
// `path`, `canonicalUrl`, `publishedAt`, `description` when it has one, and
// `coverImageCid` (the CID of its stored cover blob) when it has one.
//
// A plan is `{ creations, updates, deletions, refusal }`. Creations and the
// `document` of each update are the complete Document to write, with
// `coverImage: { url, cid }` where the executor must upload that image and
// swap in the resulting blob. A refused plan has a `refusal` string and is
// otherwise empty, so an executor that ignores it still has nothing to write.
const refuse = (reason) => ({
	creations: [],
	updates: [],
	deletions: [],
	refusal: reason,
});

// More deletions than this in one run is treated as a bug, not an edit. Small on
// purpose: pulling a Post or two back is ordinary, but a regression that
// unpublishes the archive must need a human, not go through quietly.
export const MAX_DELETIONS = 3;

// Whether an existing Document would change if rewritten as `planned`. Every
// field a Document is written with is compared, not only some: an unnoticed
// difference is a Document that quietly stays wrong. `path` is the match key, so
// it can't differ, and `site` is filtered on before this is reached.
//
// Dates compare as instants, since the same moment can be spelled several ways
// and re-writing a Document over a difference in notation would never settle.
function differs(current, planned) {
	return (
		current.title !== planned.title ||
		current.description !== planned.description ||
		current.canonicalUrl !== planned.canonicalUrl ||
		Date.parse(current.publishedAt) !== Date.parse(planned.publishedAt) ||
		current.coverImageCid !== planned.coverImage?.cid
	);
}

const isFilled = (value) => typeof value === "string" && value !== "";

// The fields every Document is written with, and a Share image only counts if
// it comes with the identity used to tell whether it changed.
const isWellFormed = (post) =>
	["title", "path", "canonicalUrl", "publishedAt"].every((field) =>
		isFilled(post[field]),
	) &&
	(post.image === undefined || isFilled(post.imageCid));

export function planDocuments(
	manifest,
	allDocuments,
	{ publication, maxDeletions = MAX_DELETIONS },
) {
	if (manifest.length === 0) {
		return refuse("the manifest is empty; refusing to plan anything from it.");
	}

	// A manifest that is present but wrong is as dangerous as an empty one: an
	// entry with a hole in it would be written over a good Document.
	const seen = new Set();
	for (const post of manifest) {
		if (!isWellFormed(post)) {
			return refuse(
				`the manifest has a malformed entry (${JSON.stringify(post.path ?? post)}); refusing to plan anything from it.`,
			);
		}
		if (seen.has(post.path)) {
			return refuse(
				`the manifest lists ${post.path} twice; refusing to plan anything from it.`,
			);
		}
		seen.add(post.path);
	}

	// An account can hold several Publications and the PDS lists all of their
	// Documents together. Only this Publication's are ours to update or delete;
	// treating the rest as stale would unpublish somebody else's writing.
	const existing = allDocuments.filter((doc) => doc.site === publication);
	const existingByPath = new Map(existing.map((doc) => [doc.path, doc]));

	// Two Documents for one path can't both be right, and picking one would leave
	// the other silently unmanaged forever, so a person decides.
	if (existingByPath.size !== existing.length) {
		return refuse(
			"more than one Document exists for the same path; refusing to guess which is right.",
		);
	}

	const creations = [];
	const updates = [];
	for (const post of manifest) {
		const document = {
			site: publication,
			title: post.title,
			publishedAt: post.publishedAt,
			path: post.path,
			canonicalUrl: post.canonicalUrl,
			...(post.description && { description: post.description }),
			...(post.image && { coverImage: { url: post.image, cid: post.imageCid } }),
		};
		const current = existingByPath.get(post.path);
		if (!current) {
			creations.push(document);
		} else if (differs(current, document)) {
			updates.push({ uri: current.uri, document });
		}
	}

	const manifestPaths = new Set(manifest.map((post) => post.path));
	const deletions = existing
		.filter((doc) => !manifestPaths.has(doc.path))
		.map((doc) => ({ uri: doc.uri, path: doc.path }));

	if (deletions.length > maxDeletions) {
		return refuse(
			`the plan has ${deletions.length} deletions, more than the ${maxDeletions} allowed in one run; refusing to plan anything.`,
		);
	}

	return { creations, updates, deletions, refusal: null };
}
