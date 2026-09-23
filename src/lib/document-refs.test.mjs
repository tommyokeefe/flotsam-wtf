import assert from "node:assert/strict";
import { test } from "node:test";
import { documentRefsByPath, lookupDocumentRefs } from "./document-refs.mjs";

const DID = "did:plc:test";
const PUBLICATION = `at://${DID}/site.standard.publication/3kpub`;
const OTHER_PUBLICATION = `at://${DID}/site.standard.publication/3kother`;
const PDS = "https://pds.example";

// A record as `com.atproto.repo.listRecords` returns it, with overrides for the
// one thing a test is about.
const record = (rkey, value = {}) => ({
	uri: `at://${DID}/site.standard.document/${rkey}`,
	cid: `cid-${rkey}`,
	value: { site: PUBLICATION, path: "/posts/wind", title: "Wind", ...value },
});

// --- documentRefsByPath -----------------------------------------------------

test("a Document of this Publication is found by its path", () => {
	const refs = documentRefsByPath([record("a")], PUBLICATION);
	assert.deepEqual([...refs], [["/posts/wind", `at://${DID}/site.standard.document/a`]]);
});

test("a Document of another Publication on the same account is ignored", () => {
	const refs = documentRefsByPath(
		[record("a", { site: OTHER_PUBLICATION }), record("b", { path: "/posts/wind" })],
		PUBLICATION,
	);
	assert.deepEqual([...refs], [["/posts/wind", `at://${DID}/site.standard.document/b`]]);
});

test("two Documents for one path name neither, rather than guess", () => {
	const refs = documentRefsByPath([record("a"), record("b")], PUBLICATION);
	assert.equal(refs.size, 0);
});

test("a record with no usable path or uri is skipped", () => {
	const refs = documentRefsByPath(
		[record("a", { path: undefined }), { ...record("b"), uri: undefined }, null, record("c", { path: "/posts/sea" })],
		PUBLICATION,
	);
	assert.deepEqual([...refs.keys()], ["/posts/sea"]);
});

// --- lookupDocumentRefs -----------------------------------------------------

const json = (body, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const didDocument = json({
	service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: PDS }],
});

// A fetch that answers from a table of URL prefixes, and records what it was asked.
function fakeFetch(routes) {
	const calls = [];
	const fetch = async (url, init = {}) => {
		calls.push({ url: String(url), headers: new Headers(init.headers) });
		for (const [prefix, answer] of routes) {
			if (String(url).startsWith(prefix)) return typeof answer === "function" ? answer(url, init) : answer.clone();
		}
		throw new TypeError("fetch failed");
	};
	return { fetch, calls };
}

const quiet = () => {};

test("the lookup resolves the account's PDS and reads every page of Documents", async () => {
	const { fetch, calls } = fakeFetch([
		[`https://plc.directory/${DID}`, didDocument],
		[
			`${PDS}/xrpc/com.atproto.repo.listRecords`,
			(url) =>
				new URL(url).searchParams.get("cursor") === "next"
					? json({ records: [record("b", { path: "/posts/sea" })] })
					: json({ records: [record("a")], cursor: "next" }),
		],
	]);
	const refs = await lookupDocumentRefs(PUBLICATION, { fetch, warn: quiet });
	assert.deepEqual([...refs.keys()].sort(), ["/posts/sea", "/posts/wind"]);
	// No credential: the build must not need one.
	assert.ok(calls.every(({ headers }) => !headers.has("Authorization")));
	assert.ok(
		calls.slice(1).every(({ url }) => {
			const params = new URL(url).searchParams;
			return params.get("repo") === DID && params.get("collection") === "site.standard.document";
		}),
	);
});

test("an unreachable PDS gives no references, and says why", async () => {
	const warnings = [];
	const { fetch } = fakeFetch([[`https://plc.directory/${DID}`, didDocument]]);
	const refs = await lookupDocumentRefs(PUBLICATION, { fetch, warn: (m) => warnings.push(m) });
	assert.equal(refs.size, 0);
	assert.equal(warnings.length, 1);
});

test("a failing PDS gives no references", async () => {
	const { fetch } = fakeFetch([
		[`https://plc.directory/${DID}`, didDocument],
		[`${PDS}/xrpc/`, json({ error: "InternalServerError" }, 500)],
	]);
	assert.equal((await lookupDocumentRefs(PUBLICATION, { fetch, warn: quiet })).size, 0);
});

test("a slow PDS gives no references once the time is up", async () => {
	const { fetch } = fakeFetch([
		[`https://plc.directory/${DID}`, didDocument],
		[
			`${PDS}/xrpc/`,
			(_url, init) =>
				new Promise((_resolve, reject) => {
					init.signal.addEventListener("abort", () => reject(init.signal.reason));
				}),
		],
	]);
	const started = Date.now();
	const refs = await lookupDocumentRefs(PUBLICATION, { fetch, warn: quiet, timeoutMs: 50 });
	assert.equal(refs.size, 0);
	assert.ok(Date.now() - started < 1000);
});

test("a PDS that answers with something other than a list of records gives no references", async () => {
	const { fetch } = fakeFetch([
		[`https://plc.directory/${DID}`, didDocument],
		[`${PDS}/xrpc/`, json({ nope: true })],
	]);
	assert.equal((await lookupDocumentRefs(PUBLICATION, { fetch, warn: quiet })).size, 0);
});

test("a PDS that hands back a cursor it already gave gives no references, without waiting out the deadline", async () => {
	const { fetch } = fakeFetch([
		[`https://plc.directory/${DID}`, didDocument],
		[`${PDS}/xrpc/`, json({ records: [record("a")], cursor: "same" })],
	]);
	const started = Date.now();
	assert.equal((await lookupDocumentRefs(PUBLICATION, { fetch, warn: quiet })).size, 0);
	assert.ok(Date.now() - started < 1000);
});

test("something thrown that isn't an Error still gives no references", async () => {
	const fetch = async () => {
		throw undefined;
	};
	assert.equal((await lookupDocumentRefs(PUBLICATION, { fetch, warn: quiet })).size, 0);
});

test("a DID document with no https PDS gives no references", async () => {
	for (const service of [[], [{ id: "#atproto_pds", serviceEndpoint: "http://pds.example" }]]) {
		const { fetch } = fakeFetch([[`https://plc.directory/${DID}`, json({ service })]]);
		assert.equal((await lookupDocumentRefs(PUBLICATION, { fetch, warn: quiet })).size, 0);
	}
});

test("no Publication yet means no lookup at all", async () => {
	const { fetch, calls } = fakeFetch([]);
	assert.equal((await lookupDocumentRefs(null, { fetch, warn: quiet })).size, 0);
	assert.equal(calls.length, 0);
});
