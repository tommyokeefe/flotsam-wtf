import assert from "node:assert/strict";
import { test } from "node:test";
import { planDocuments } from "./plan-documents.mjs";

const PUBLICATION = "at://did:plc:test/site.standard.publication/3kpub";

// A manifest entry as the site emits it, and a Document as it already exists on
// the PDS. Written out longhand, with overrides for the one field a test is
// about, so each test reads as "this input gives that plan".
const post = (overrides = {}) => ({
	title: "Wind",
	path: "/posts/wind",
	canonicalUrl: "https://www.flotsam.wtf/posts/wind/",
	publishedAt: "2026-09-11T00:00:00.000Z",
	...overrides,
});

const document = (overrides = {}) => ({
	uri: "at://did:plc:test/site.standard.document/3kdoc1",
	site: PUBLICATION,
	title: "Wind",
	path: "/posts/wind",
	canonicalUrl: "https://www.flotsam.wtf/posts/wind/",
	publishedAt: "2026-09-11T00:00:00.000Z",
	...overrides,
});

const plan = (manifest, existing, options) =>
	planDocuments(manifest, existing, { publication: PUBLICATION, ...options });

test("a Post with no Document produces a creation", () => {
	assert.deepEqual(plan([post()], []), {
		creations: [
			{
				site: PUBLICATION,
				title: "Wind",
				publishedAt: "2026-09-11T00:00:00.000Z",
				path: "/posts/wind",
				canonicalUrl: "https://www.flotsam.wtf/posts/wind/",
			},
		],
		updates: [],
		deletions: [],
		refusal: null,
	});
});

test("a Post whose Document already matches produces nothing", () => {
	assert.deepEqual(plan([post()], [document()]), {
		creations: [],
		updates: [],
		deletions: [],
		refusal: null,
	});
});

test("a changed title produces an update that keeps the Document's identity", () => {
	assert.deepEqual(plan([post({ title: "Windy" })], [document()]), {
		creations: [],
		updates: [
			{
				uri: "at://did:plc:test/site.standard.document/3kdoc1",
				document: {
					site: PUBLICATION,
					title: "Windy",
					publishedAt: "2026-09-11T00:00:00.000Z",
					path: "/posts/wind",
					canonicalUrl: "https://www.flotsam.wtf/posts/wind/",
				},
			},
		],
		deletions: [],
		refusal: null,
	});
});

test("a description is carried into the Document when the Post has one", () => {
	const { creations } = plan([post({ description: "A poem about wind." })], []);
	assert.deepEqual(creations, [
		{
			site: PUBLICATION,
			title: "Wind",
			publishedAt: "2026-09-11T00:00:00.000Z",
			path: "/posts/wind",
			canonicalUrl: "https://www.flotsam.wtf/posts/wind/",
			description: "A poem about wind.",
		},
	]);
});

test("a changed description produces an update", () => {
	const { updates } = plan(
		[post({ description: "A poem about wind." })],
		[document({ description: "A poem." })],
	);
	assert.equal(updates.length, 1);
	assert.equal(updates[0].document.description, "A poem about wind.");
});

test("adding a description to a Post that had none produces an update", () => {
	const { updates } = plan([post({ description: "New." })], [document()]);
	assert.equal(updates.length, 1);
});

test("removing a Post's description produces an update whose Document has none", () => {
	const { updates } = plan([post()], [document({ description: "Old." })]);
	assert.equal(updates.length, 1);
	assert.equal("description" in updates[0].document, false);
});

test("a Document whose Post is no longer in the manifest produces a deletion", () => {
	const gone = document({
		uri: "at://did:plc:test/site.standard.document/3kdoc2",
		path: "/posts/old",
		title: "Old",
	});
	assert.deepEqual(plan([post()], [document(), gone]), {
		creations: [],
		updates: [],
		deletions: [{ uri: "at://did:plc:test/site.standard.document/3kdoc2", path: "/posts/old" }],
		refusal: null,
	});
});

test("a Post whose slug changed produces a deletion of the old Document and a creation of a new one", () => {
	const renamed = post({
		path: "/posts/wind-2",
		canonicalUrl: "https://www.flotsam.wtf/posts/wind-2/",
	});
	const result = plan([renamed], [document()]);
	assert.deepEqual(result.deletions, [
		{ uri: "at://did:plc:test/site.standard.document/3kdoc1", path: "/posts/wind" },
	]);
	assert.deepEqual(
		result.creations.map((doc) => doc.path),
		["/posts/wind-2"],
	);
	assert.deepEqual(result.updates, []);
});

test("an empty manifest is refused and plans no deletions", () => {
	const result = plan([], [document()]);
	assert.match(result.refusal, /empty/i);
	assert.deepEqual(result.deletions, []);
	assert.deepEqual(result.creations, []);
	assert.deepEqual(result.updates, []);
});

// Stale Documents whose Posts have gone, with distinct paths and identities.
const stale = (count) =>
	Array.from({ length: count }, (_, i) =>
		document({
			uri: `at://did:plc:test/site.standard.document/3kold${i}`,
			path: `/posts/old-${i}`,
			title: `Old ${i}`,
		}),
	);

test("deletions above the threshold are refused and nothing is planned", () => {
	const result = plan([post({ title: "Windy" })], [document(), ...stale(3)], {
		maxDeletions: 2,
	});
	assert.match(result.refusal, /3 deletions/);
	assert.deepEqual(result.deletions, []);
	assert.deepEqual(result.updates, []);
	assert.deepEqual(result.creations, []);
});

test("deletions exactly at the threshold are allowed", () => {
	const result = plan([post()], [document(), ...stale(2)], { maxDeletions: 2 });
	assert.equal(result.refusal, null);
	assert.equal(result.deletions.length, 2);
});

test("by default, unpublishing a large share of the archive in one run is refused", () => {
	const result = plan([post()], [document(), ...stale(10)]);
	assert.notEqual(result.refusal, null);
	assert.deepEqual(result.deletions, []);
});

// A Share image, as the manifest gives it (`image`, the built JPEG's URL) plus
// the identity of that file's bytes (`imageCid`), which whoever runs the plan
// works out because the planner does no I/O.
const withImage = (cid = "bafkreiaaa") => ({
	image: "https://www.flotsam.wtf/_astro/share.abc.jpeg",
	imageCid: cid,
});

test("a Share image is carried into the Document as its cover image", () => {
	const { creations } = plan([post(withImage())], []);
	assert.deepEqual(creations[0].coverImage, {
		url: "https://www.flotsam.wtf/_astro/share.abc.jpeg",
		cid: "bafkreiaaa",
	});
});

test("a Share image whose bytes changed produces an update", () => {
	const { updates } = plan(
		[post(withImage("bafkreibbb"))],
		[document({ coverImageCid: "bafkreiaaa" })],
	);
	assert.equal(updates.length, 1);
	assert.equal(updates[0].document.coverImage.cid, "bafkreibbb");
});

test("a Share image that is unchanged produces nothing", () => {
	const result = plan(
		[post(withImage("bafkreiaaa"))],
		[document({ coverImageCid: "bafkreiaaa" })],
	);
	assert.deepEqual(result.updates, []);
	assert.deepEqual(result.creations, []);
});

test("gaining a Share image produces an update", () => {
	const { updates } = plan([post(withImage())], [document()]);
	assert.equal(updates.length, 1);
	assert.equal(updates[0].document.coverImage.cid, "bafkreiaaa");
});

test("losing a Share image produces an update whose Document has no cover image", () => {
	const { updates } = plan([post()], [document({ coverImageCid: "bafkreiaaa" })]);
	assert.equal(updates.length, 1);
	assert.equal("coverImage" in updates[0].document, false);
});

test("a changed canonical URL produces an update", () => {
	const { updates } = plan(
		[post()],
		[document({ canonicalUrl: "https://flotsam.wtf/posts/wind/" })],
	);
	assert.equal(updates.length, 1);
	assert.equal(updates[0].document.canonicalUrl, "https://www.flotsam.wtf/posts/wind/");
});

test("a changed published date produces an update", () => {
	const { updates } = plan(
		[post({ publishedAt: "2026-09-12T00:00:00.000Z" })],
		[document()],
	);
	assert.equal(updates.length, 1);
});

test("the same published moment spelled differently produces nothing", () => {
	const result = plan(
		[post({ publishedAt: "2026-09-11T00:00:00.000Z" })],
		[document({ publishedAt: "2026-09-11T00:00:00+00:00" })],
	);
	assert.deepEqual(result.updates, []);
});

const OTHER_PUBLICATION = "at://did:plc:test/site.standard.publication/3kother";

test("a Document belonging to another Publication is never deleted", () => {
	const foreign = document({
		uri: "at://did:plc:test/site.standard.document/3kfor1",
		site: OTHER_PUBLICATION,
		path: "/posts/not-flotsam",
		title: "Somebody else's",
	});
	const result = plan([post()], [document(), foreign]);
	assert.deepEqual(result.deletions, []);
	assert.deepEqual(result.updates, []);
	assert.equal(result.refusal, null);
});

test("another Publication's Document at the same path is not mistaken for ours", () => {
	const foreign = document({
		uri: "at://did:plc:test/site.standard.document/3kfor1",
		site: OTHER_PUBLICATION,
		title: "Somebody else's wind",
	});
	const result = plan([post()], [foreign]);
	assert.deepEqual(result.updates, []);
	assert.deepEqual(result.deletions, []);
	assert.deepEqual(
		result.creations.map((doc) => doc.site),
		[PUBLICATION],
	);
});

test("a manifest entry missing a required field is refused rather than written", () => {
	for (const field of ["title", "path", "canonicalUrl", "publishedAt"]) {
		for (const bad of [undefined, ""]) {
			const result = plan([post({ [field]: bad })], [document()]);
			assert.match(result.refusal, /malformed/i, `${field} = ${JSON.stringify(bad)}`);
			assert.deepEqual(result.updates, []);
			assert.deepEqual(result.creations, []);
			assert.deepEqual(result.deletions, []);
		}
	}
});

test("a manifest with a Share image but no way to identify it is refused", () => {
	const result = plan([post({ image: "https://www.flotsam.wtf/_astro/share.abc.jpeg" })], []);
	assert.match(result.refusal, /malformed/i);
});

test("a manifest listing the same path twice is refused", () => {
	const result = plan([post(), post({ title: "Wind again" })], []);
	assert.match(result.refusal, /twice|duplicate/i);
	assert.deepEqual(result.creations, []);
});

test("two existing Documents at one path are refused rather than guessed between", () => {
	const twin = document({ uri: "at://did:plc:test/site.standard.document/3kdoc9" });
	const result = plan([post()], [document(), twin]);
	assert.match(result.refusal, /more than one Document/i);
	assert.deepEqual(result.updates, []);
	assert.deepEqual(result.deletions, []);
});

test("a planned Document carries only its metadata: no prose, no Tags, nothing else", () => {
	const noisy = post({
		description: "A poem about wind.",
		...withImage(),
		body: "The whole of the Post's prose.",
		textContent: "The whole of the Post's prose.",
		tags: ["poem"],
		draft: false,
	});
	const [created] = plan([noisy], []).creations;
	assert.deepEqual(Object.keys(created).sort(), [
		"canonicalUrl",
		"coverImage",
		"description",
		"path",
		"publishedAt",
		"site",
		"title",
	]);
});

test("planning does not modify what it was given", () => {
	const deepFreeze = (value) => {
		for (const child of Object.values(value)) {
			if (child && typeof child === "object") deepFreeze(child);
		}
		return Object.freeze(value);
	};
	const manifest = deepFreeze([post({ title: "Windy" }), post({ path: "/posts/new" })]);
	const existing = deepFreeze([document(), ...stale(2)]);
	// A frozen input makes any write throw (this file is a module, so strict).
	assert.doesNotThrow(() => plan(manifest, existing));
});

test("once a plan has been carried out, planning again produces nothing", () => {
	const manifest = [
		post({ description: "A poem about wind.", ...withImage("bafkreiaaa") }),
		post({ path: "/posts/plain", title: "Plain", canonicalUrl: "https://www.flotsam.wtf/posts/plain/" }),
		post({ path: "/posts/renamed", title: "Renamed", canonicalUrl: "https://www.flotsam.wtf/posts/renamed/" }),
	];
	const before = [
		document({ title: "Wind, old title", coverImageCid: "bafkreizzz" }),
		document({ uri: "at://did:plc:test/site.standard.document/3kgone", path: "/posts/gone", title: "Gone" }),
	];

	// Carry the plan out the way an executor would, then look again.
	const first = plan(manifest, before);
	assert.equal(first.refusal, null);
	const settled = [
		...before.filter(
			(doc) =>
				!first.deletions.some((d) => d.uri === doc.uri) &&
				!first.updates.some((u) => u.uri === doc.uri),
		),
		...first.updates.map(({ uri, document: doc }) => ({ uri, ...asExisting(doc) })),
		...first.creations.map((doc, i) => ({
			uri: `at://did:plc:test/site.standard.document/3knew${i}`,
			...asExisting(doc),
		})),
	];

	assert.deepEqual(plan(manifest, settled), {
		creations: [],
		updates: [],
		deletions: [],
		refusal: null,
	});
});

// What the PDS hands back for a Document that was written from a planned one:
// the cover image is a stored blob, so all that's left of it is its identity.
function asExisting({ coverImage, ...rest }) {
	return { ...rest, ...(coverImage && { coverImageCid: coverImage.cid }) };
}
