// Which Document points at which Post, asked of the PDS at build time, so each
// Post's page can name its Document in its head (#42).
//
// Asked, not stored: a Document's rkey is a TID assigned when publishing creates
// it, so it can't be derived from the Post, and keeping it in the repo would be
// a committed file that drifts from the PDS (ADR 0008). The lookup is a public
// read and needs no credential, so a local build and a preview deploy need no
// secret.
//
// It never fails a build. Anything that goes wrong (no network, a slow or
// failing PDS, an answer it doesn't understand) gives no references and a
// warning, and the pages simply don't name their Documents until the next build
// (ADR 0009). The ATmosphere is somewhere Posts are announced, never something
// the site needs in order to build.
//
// A plain .mjs with `fetch` passed in, so `npm test` can run it on Node alone and
// without the network. Deliberately not scripts/lib/atproto.mjs: that throws, as
// a publishing tool should, and has no timeout, which a build can't afford.

const DOCUMENT = "site.standard.document";

// Long enough for a PDS on a slow day, short enough that one which never answers
// costs a build seconds, not minutes.
const TIMEOUT_MS = 10_000;

/**
 * The AT-URI of each of this Publication's Documents, by `path`, from records as
 * `com.atproto.repo.listRecords` returns them.
 *
 * An account can hold several Publications and the PDS lists all their
 * Documents together, so only those whose `site` is this Publication count. Two
 * for one path is a state the publisher refuses to act on (ADR 0008); here it
 * names neither, since a page naming the wrong record is worse than naming none.
 *
 * @param {unknown[]} records
 * @param {string} publication the Publication's AT-URI
 * @returns {Map<string, string>}
 */
export function documentRefsByPath(records, publication) {
	const refs = new Map();
	const ambiguous = new Set();
	for (const record of records) {
		const { uri, value } = /** @type {any} */ (record) ?? {};
		if (value?.site !== publication) continue;
		if (typeof uri !== "string" || typeof value.path !== "string") continue;
		if (refs.has(value.path)) ambiguous.add(value.path);
		refs.set(value.path, uri);
	}
	for (const path of ambiguous) refs.delete(path);
	return refs;
}

/**
 * Every Document reference for the Publication, read from the account's PDS.
 * Never throws: on any failure, an empty Map and one warning.
 *
 * @param {string | null} publication the Publication's AT-URI, or null before it exists
 * @param {{ fetch?: typeof globalThis.fetch, warn?: (message: string) => void, timeoutMs?: number }} [options]
 * @returns {Promise<Map<string, string>>}
 */
export async function lookupDocumentRefs(
	publication,
	{ fetch = globalThis.fetch, warn = console.warn, timeoutMs = TIMEOUT_MS } = {},
) {
	if (!publication) return new Map();
	// One deadline for the whole lookup, however many requests it takes. A plain
	// timer rather than `AbortSignal.timeout`, whose timer doesn't hold the
	// process open: a request that is merely pending would then let Node exit
	// mid-build, silently, instead of reaching the deadline.
	const controller = new AbortController();
	const { signal } = controller;
	const deadline = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const did = /^at:\/\/(did:plc:[a-z0-9]+)\//.exec(publication)?.[1];
		if (!did) throw new Error(`${publication} isn't a did:plc AT-URI`);
		const pds = await resolvePds(did, fetch, signal);

		const records = [];
		// Cursors seen so far. A PDS that hands one back twice would page forever,
		// and one that answers instantly never lets the deadline fire.
		const seen = new Set();
		let cursor;
		do {
			const url = new URL("/xrpc/com.atproto.repo.listRecords", pds);
			url.search = new URLSearchParams({
				repo: did,
				collection: DOCUMENT,
				limit: "100",
				...(cursor && { cursor }),
			}).toString();
			const page = await getJson(url, fetch, signal);
			if (!Array.isArray(page.records)) throw new Error("listRecords returned no list of records");
			records.push(...page.records);
			cursor = page.cursor;
			if (cursor && seen.has(cursor)) throw new Error("listRecords repeated a cursor");
			seen.add(cursor);
		} while (cursor);

		return documentRefsByPath(records, publication);
	} catch (error) {
		// `error` can be anything that was thrown, including nothing at all.
		const reason = signal.aborted
			? `no answer within ${timeoutMs}ms`
			: String(/** @type {any} */ (error)?.message ?? error);
		warn(`document-refs: building without Document references (${reason}).`);
		return new Map();
	} finally {
		clearTimeout(deadline);
	}
}

// The PDS named in the account's DID document. https only: what it says ends up
// in every Post's head, so it shouldn't come over a connection anyone could edit.
async function resolvePds(did, fetch, signal) {
	const didDocument = await getJson(`https://plc.directory/${did}`, fetch, signal);
	const endpoint = didDocument.service?.find?.(
		(/** @type {any} */ service) => service?.id === "#atproto_pds",
	)?.serviceEndpoint;
	if (typeof endpoint !== "string" || !URL.canParse(endpoint) || new URL(endpoint).protocol !== "https:") {
		throw new Error(`${did}'s DID document names no https PDS`);
	}
	return endpoint;
}

async function getJson(url, fetch, signal) {
	const response = await fetch(url, { signal });
	if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`);
	return (await response.json()) ?? {};
}
