// The decision half of publishing: given what the site says should exist (the
// manifest) and what does exist on the PDS, what to create, update and delete —
// or whether to refuse the whole thing.
//
// Everything destructive is decided here and nowhere else. The executor (#41) is
// meant to be a loop over a plan that has already been validated, so it can't be
// the place a bad delete slips through, and the dangerous logic can be tested by
// passing in two arrays. This performs no I/O and never mutates its arguments;
// anything that needs the network or the disk (like an image's CID) is done by
// the caller and passed in. See ADR 0008 for why the manifest is authoritative,
// deletions included, and ADR 0007 for why a Document carries no prose.
//
// The manifest is a list of what the site emits at /posts.json — `title`,
// `path`, `publishedAt`, and `description` / `image` only when the Post has
// them (it also carries a `canonicalUrl`, which the planner ignores: see below)
// — plus `imageCid`, the CID of that image's bytes, which the caller works out
// from the built file because the planner reads no files.
//
// `allDocuments` is every `site.standard.document` the PDS holds for the
// account, each with its `uri`, `site`, `title`, `path`, `publishedAt`,
// `description` when it has one, and `coverImageCid` (the CID of its stored
// cover blob) when it has one. It must be the *complete* list: a
// caller that stops paging early makes Posts that are already published look
// new, and they would be created twice.
//
// Options: `publication` (required) is the AT-URI of the Publication being
// planned for; only its Documents are touched. `maxDeletions` (optional) is the
// deliberate way to allow a bigger clear-out for one run. Both are the caller's
// code, so a bad one throws.
//
// A Document has no canonical URL of its own. The lexicon has no such field: a
// reader builds it from the Publication's `url` plus the Document's `path`. So
// the manifest's `canonicalUrl` is never written or compared; a planner that did
// would see an existing Document as always different and rewrite every one of
// them on every run.
//
// A plan is `{ creations, updates, deletions, refusal }`. Creations and the
// `document` of each update are the complete Document to write, with
// `coverImage: { url, cid }` where the executor must upload that image and swap
// in the resulting blob. Bad *data* is refused, not thrown: a refused plan has a
// `refusal` string and is otherwise empty, so an executor that ignores it still
// has nothing to write.

const refusedPlan = (reason) => ({
	creations: [],
	updates: [],
	deletions: [],
	refusal: reason,
});

// More deletions than this in one run is treated as a bug, not an edit. Small on
// purpose: pulling a Post or two back is ordinary, but a regression that
// unpublishes the archive must need a human, not go through quietly.
const MAX_DELETIONS = 3;

const isNonEmptyString = (value) => typeof value === "string" && value !== "";

// The fields every Document is written with, and all the planner needs of an
// entry. A date that can't be read would
// compare unequal to everything, forever, so it counts as a hole too. A Share
// image only counts if it comes with the identity used to tell whether it
// changed.
const isWellFormedEntry = (entry) =>
	entry !== null &&
	typeof entry === "object" &&
	["title", "path", "publishedAt"].every((field) =>
		isNonEmptyString(entry[field]),
	) &&
	!Number.isNaN(Date.parse(entry.publishedAt)) &&
	(entry.image === undefined || isNonEmptyString(entry.imageCid));

// A Document has to say whose it is and where it lives before anything can be
// decided about it.
const isAttributable = (doc) =>
	doc !== null &&
	typeof doc === "object" &&
	["uri", "site", "path"].every((field) => isNonEmptyString(doc[field]));

// Whether an existing Document would change if rewritten as `planned`. Every
// field a Document is written with is compared, not only some: an unnoticed
// difference is a Document that quietly stays wrong. `path` is the match key, so
// it can't differ, and `site` is filtered on before this is reached.
//
// Dates compare as instants, since the same moment can be spelled several ways
// and re-writing a Document over a difference in notation would never settle.
// An empty description is no description, which is how the manifest treats it.
function differs(current, planned) {
	return (
		current.title !== planned.title ||
		(current.description || undefined) !== planned.description ||
		Date.parse(current.publishedAt) !== Date.parse(planned.publishedAt) ||
		current.coverImageCid !== planned.coverImage?.cid
	);
}

export function planDocuments(manifest, allDocuments, options = {}) {
	const { publication, maxDeletions } = options;

	// These are the caller's own code, not data, so a bad one is a bug to surface
	// rather than a state to refuse. `NaN` or a negative limit in particular would
	// quietly switch the deletion guard off, since nothing is greater than `NaN`.
	if (!isNonEmptyString(publication)) {
		throw new TypeError(
			"planDocuments needs `publication`: the AT-URI of the Publication it plans for.",
		);
	}
	if (
		maxDeletions !== undefined &&
		!(Number.isInteger(maxDeletions) && maxDeletions >= 0)
	) {
		throw new TypeError(
			`\`maxDeletions\` must be a whole number, 0 or more; got ${String(maxDeletions)}.`,
		);
	}

	if (!Array.isArray(manifest)) {
		return refusedPlan("the manifest isn't a list; refusing to plan anything from it.");
	}
	if (manifest.length === 0) {
		return refusedPlan("the manifest is empty; refusing to plan anything from it.");
	}

	// A manifest that is present but wrong is as dangerous as an empty one: an
	// entry with a hole in it would be written over a good Document.
	const seen = new Set();
	for (const entry of manifest) {
		if (!isWellFormedEntry(entry)) {
			return refusedPlan(
				`the manifest has a malformed entry (${JSON.stringify(entry?.path ?? entry)}); refusing to plan anything from it.`,
			);
		}
		if (seen.has(entry.path)) {
			return refusedPlan(
				`the manifest lists ${entry.path} twice; refusing to plan anything from it.`,
			);
		}
		seen.add(entry.path);
	}

	if (!Array.isArray(allDocuments)) {
		return refusedPlan(
			"the existing Documents aren't a list; refusing to plan anything without knowing what exists.",
		);
	}
	// Whose a Document is decides whether it is ours to delete, so one that can't
	// be attributed can't be left out quietly: it would be skipped here and then
	// a second Document created next to it, unmanaged from then on.
	if (!allDocuments.every(isAttributable)) {
		return refusedPlan(
			"an existing Document has no usable uri, site or path, so I can't tell whose it is; refusing to plan anything.",
		);
	}

	// An account can hold several Publications and the PDS lists all of their
	// Documents together. Only this Publication's are ours to update or delete;
	// treating the rest as stale would unpublish somebody else's writing.
	const existing = allDocuments.filter((doc) => doc.site === publication);
	const existingByPath = new Map(existing.map((doc) => [doc.path, doc]));

	// Two Documents for one path can't both be right, and picking one would leave
	// the other silently unmanaged forever, so a person decides.
	if (existingByPath.size !== existing.length) {
		return refusedPlan(
			"more than one Document exists for the same path; refusing to guess which is right.",
		);
	}

	const creations = [];
	const updates = [];
	for (const entry of manifest) {
		const document = {
			site: publication,
			title: entry.title,
			publishedAt: entry.publishedAt,
			path: entry.path,
			...(entry.description && { description: entry.description }),
			...(entry.image && { coverImage: { url: entry.image, cid: entry.imageCid } }),
		};
		const current = existingByPath.get(entry.path);
		if (!current) {
			creations.push(document);
		} else if (differs(current, document)) {
			updates.push({ uri: current.uri, document });
		}
	}

	const deletions = existing
		.filter((doc) => !seen.has(doc.path))
		.map((doc) => ({ uri: doc.uri, path: doc.path }));

	// Unless a person has set a limit for this run, allow at most three deletions,
	// and never more than half of what exists: a flat three would let a truncated
	// manifest wipe a small archive outright. Only this Publication's Documents
	// count towards the size of the archive.
	const limit =
		maxDeletions ??
		Math.min(MAX_DELETIONS, Math.max(1, Math.floor(existing.length / 2)));
	if (deletions.length > limit) {
		return refusedPlan(
			`the plan has ${deletions.length} deletions, more than the ${limit} allowed in one run; refusing to plan anything.`,
		);
	}

	return { creations, updates, deletions, refusal: null };
}
