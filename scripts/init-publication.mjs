// One-off: create Flotsam's Publication record on the PDS.
//
// Run by hand, by Tommy, with his own credentials. The write is never run by an
// agent and never in CI: creating the record needs an app password, which is why
// this is a script you run once and not part of the build.
//
// Read the password without leaving it in your shell history:
//
//   read -rs ATPROTO_APP_PASSWORD && export ATPROTO_APP_PASSWORD
//   ATPROTO_IDENTIFIER=<handle or DID> npm run init:publication
//
// It prints the created AT-URI and stops. It deliberately does not write that
// into the repo: paste it into `PUBLICATION_AT_URI` in src/lib/site.mjs and
// commit it yourself, once, so that change is a visible, reviewable act.
//
// `--dry-run` needs no password, only the identifier:
//
//   ATPROTO_IDENTIFIER=<handle or DID> npm run init:publication -- --dry-run
//
// It resolves the account, looks for an existing Publication and prints the
// record it would create, without logging in or writing anything (reading a
// repo is public; only writing needs a credential). It exits non-zero in the
// same cases a real run would refuse, so it is a faithful preview.
//
// Credentials come from the environment only, and are never printed or stored.
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "../src/lib/site.mjs";

const COLLECTION = "site.standard.publication";
// Only used to turn a handle into a DID. Everything else talks to the
// account's own PDS, wherever that is.
const PUBLIC_APPVIEW = "https://public.api.bsky.app";

const dryRun = process.argv.includes("--dry-run");

function fail(message) {
	console.error(`init-publication: ${message}`);
	process.exit(1);
}

// Checked before any network call, so a missing input costs nothing.
const identifier = process.env.ATPROTO_IDENTIFIER;
if (!identifier) fail("set ATPROTO_IDENTIFIER to your handle or DID.");
const password = process.env.ATPROTO_APP_PASSWORD;
if (!dryRun && !password) {
	fail("set ATPROTO_APP_PASSWORD to an app password (not your account password).");
}

// The Publication's `url` is the origin, with no trailing slash — the same host
// the pages' canonicals derive from.
const siteUrl = new URL(SITE_URL).origin;

const record = {
	$type: COLLECTION,
	name: SITE_NAME,
	url: siteUrl,
	description: SITE_DESCRIPTION,
	preferences: { showInDiscover: true },
};

// A network failure ends in `fail`, not a stack trace, and says only which host
// couldn't be reached — never anything from the request.
async function request(url, init) {
	try {
		return await fetch(url, init);
	} catch (error) {
		return fail(`couldn't reach ${new URL(url).host}: ${error.cause?.code ?? error.message}`);
	}
}

// The three XRPC calls this needs, over plain fetch. Deliberately not the AT
// Protocol SDK: the repo has no runtime dependencies and a one-off script isn't
// a reason to add a large one. Errors carry the endpoint and status, and
// nothing from the request, so a failure can't echo a credential into a
// terminal or a log.
async function xrpc(base, nsid, { method = "GET", params, body, token } = {}) {
	const url = new URL(`/xrpc/${nsid}`, base);
	for (const [key, value] of Object.entries(params ?? {})) {
		url.searchParams.set(key, value);
	}
	const response = await request(url, {
		method,
		headers: {
			...(body && { "Content-Type": "application/json" }),
			...(token && { Authorization: `Bearer ${token}` }),
		},
		body: body && JSON.stringify(body),
	});
	const payload = (await response.json().catch(() => null)) ?? {};
	if (!response.ok) {
		fail(
			`${nsid} failed (${response.status}${payload.error ? ` ${payload.error}` : ""}): ${payload.message ?? "no detail"}`,
		);
	}
	return payload;
}

async function resolveDid(handleOrDid) {
	if (handleOrDid.startsWith("did:")) return handleOrDid;
	const { did } = await xrpc(PUBLIC_APPVIEW, "com.atproto.identity.resolveHandle", {
		params: { handle: handleOrDid },
	});
	return did;
}

// Where the account's repo actually lives, read from its DID document rather
// than assumed to be bsky.social, so this works for a self-hosted PDS too.
// did:plc only: that's what an account created through Bluesky or a standard
// PDS gets, and it is Tommy's.
async function resolvePds(did) {
	if (!did.startsWith("did:plc:")) fail(`only did:plc accounts are supported, not ${did}.`);
	const response = await request(`https://plc.directory/${did}`);
	if (!response.ok) fail(`couldn't fetch the DID document for ${did} (${response.status}).`);
	const didDocument = await response.json();
	const endpoint = didDocument.service?.find(
		(service) => service.id === "#atproto_pds",
	)?.serviceEndpoint;
	if (!endpoint) fail(`${did}'s DID document names no PDS.`);
	// The app password is about to be sent here, so it must not go in clear.
	if (!URL.canParse(endpoint) || new URL(endpoint).protocol !== "https:") {
		fail(`${did}'s PDS is ${endpoint}, which isn't https; refusing to send a password to it.`);
	}
	return endpoint;
}

// A DID can hold several Publications (Standard.site's own author has three),
// so the match is on `url`, never on "is there one". Pages through the whole
// collection, and ignores a trailing slash so `https://x.y/` and `https://x.y`
// count as the same site.
async function findExisting(pds, did) {
	const isSameSite = (url) =>
		typeof url === "string" && url.replace(/\/+$/, "") === siteUrl;
	let cursor;
	do {
		const page = await xrpc(pds, "com.atproto.repo.listRecords", {
			params: { repo: did, collection: COLLECTION, limit: "100", ...(cursor && { cursor }) },
		});
		const match = page.records.find((entry) => isSameSite(entry.value?.url));
		if (match) return match.uri;
		cursor = page.cursor;
	} while (cursor);
	return null;
}

const did = await resolveDid(identifier);
const pds = await resolvePds(did);

const existing = await findExisting(pds, did);
if (existing) {
	fail(
		`a Publication for ${siteUrl} already exists, so nothing was created:\n  ${existing}\n` +
			"If src/lib/site.mjs doesn't hold that AT-URI yet, that is the value to commit.",
	);
}

if (dryRun) {
	console.log(`init-publication: dry run — nothing created. Account ${did} on ${pds}.`);
	console.log(`No Publication for ${siteUrl} exists yet. Would create in ${COLLECTION}:`);
	console.log(JSON.stringify(record, null, 2));
	process.exit(0);
}

const session = await xrpc(pds, "com.atproto.server.createSession", {
	method: "POST",
	body: { identifier, password },
});
// The record is written to the session's repo, but the duplicate check above
// looked in the resolved one. They should be the same account; if they aren't,
// that check said nothing about where this would write.
if (session.did !== did) {
	fail(`logged in as ${session.did}, but checked ${did} for an existing Publication; not writing.`);
}

const created = await xrpc(pds, "com.atproto.repo.createRecord", {
	method: "POST",
	token: session.accessJwt,
	body: { repo: session.did, collection: COLLECTION, record },
});

console.log(`Created the Publication for ${siteUrl}:\n  ${created.uri}\n`);
console.log("Next: set PUBLICATION_AT_URI in src/lib/site.mjs to that value and commit it.");
