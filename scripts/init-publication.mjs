// One-off: create Flotsam's Publication record on the PDS.
//
// Run by hand, by Tommy, with his own credentials — never by an agent, and never
// in CI. Creating the record needs an app password, which is why this is a
// script you run once and not part of the build.
//
//   ATPROTO_IDENTIFIER=<handle or DID> ATPROTO_APP_PASSWORD=<app password> \
//     npm run init:publication
//
// It prints the created AT-URI and stops. It deliberately does not write that
// into the repo: paste it into `PUBLICATION_AT_URI` in src/lib/site.mjs and
// commit it yourself, once, so that change is a visible, reviewable act.
//
// `--dry-run` needs no password. It resolves the account, looks for an existing
// Publication and prints the record it would create, without logging in or
// writing anything. Reading a repo is public; only writing needs a credential.
//
// Credentials come from the environment only, and are never printed or stored.
import config from "../astro.config.mjs";
import { SITE_DESCRIPTION, SITE_NAME } from "../src/lib/site.mjs";

const COLLECTION = "site.standard.publication";
// Only used to turn a handle into a DID. Everything else talks to the
// account's own PDS, wherever that is.
const PUBLIC_APPVIEW = "https://public.api.bsky.app";

const dryRun = process.argv.includes("--dry-run");

function fail(message) {
	console.error(`init-publication: ${message}`);
	process.exit(1);
}

// The Publication's `url` is the origin, with no trailing slash, taken from the
// same `site` the pages' canonicals derive from.
const siteUrl = new URL(config.site).origin;

const record = {
	$type: COLLECTION,
	name: SITE_NAME,
	url: siteUrl,
	description: SITE_DESCRIPTION,
	preferences: { showInDiscover: true },
};

// Errors carry the endpoint and status, and nothing from the request, so a
// failure can't echo a credential into a terminal or a log.
async function xrpc(base, nsid, { method = "GET", params, body, token } = {}) {
	const url = new URL(`/xrpc/${nsid}`, base);
	if (params) {
		for (const [key, value] of Object.entries(params)) {
			url.searchParams.set(key, value);
		}
	}
	const response = await fetch(url, {
		method,
		headers: {
			...(body && { "Content-Type": "application/json" }),
			...(token && { Authorization: `Bearer ${token}` }),
		},
		body: body && JSON.stringify(body),
	});
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		fail(
			`${nsid} failed (${response.status}${payload.error ? ` ${payload.error}` : ""}): ${payload.message ?? "no detail"}`,
		);
	}
	return payload;
}

async function resolveDid(identifier) {
	if (identifier.startsWith("did:")) return identifier;
	const { did } = await xrpc(PUBLIC_APPVIEW, "com.atproto.identity.resolveHandle", {
		params: { handle: identifier },
	});
	return did;
}

// Where the account's repo actually lives. Read from the DID document rather
// than assumed to be bsky.social, so this works for a self-hosted PDS too.
async function resolvePds(did) {
	const documentUrl = did.startsWith("did:plc:")
		? `https://plc.directory/${did}`
		: did.startsWith("did:web:")
			? `https://${did.slice("did:web:".length)}/.well-known/did.json`
			: fail(`don't know how to resolve ${did}`);
	const response = await fetch(documentUrl);
	if (!response.ok) fail(`couldn't fetch the DID document for ${did} (${response.status})`);
	const document = await response.json();
	const pds = document.service?.find(
		(service) => service.id === "#atproto_pds",
	)?.serviceEndpoint;
	return pds ?? fail(`${did}'s DID document names no PDS`);
}

// A DID can hold several Publications (Standard.site's own author has three),
// so the match is on `url`, never on "is there one". Pages through the whole
// collection, and ignores a trailing slash so `https://x.y/` and `https://x.y`
// count as the same site.
async function findExisting(pds, did) {
	const same = (url) => typeof url === "string" && url.replace(/\/+$/, "") === siteUrl;
	let cursor;
	do {
		const page = await xrpc(pds, "com.atproto.repo.listRecords", {
			params: { repo: did, collection: COLLECTION, limit: "100", ...(cursor && { cursor }) },
		});
		const match = page.records.find((entry) => same(entry.value?.url));
		if (match) return match.uri;
		cursor = page.cursor;
	} while (cursor);
	return null;
}

const identifier = process.env.ATPROTO_IDENTIFIER;
if (!identifier) fail("set ATPROTO_IDENTIFIER to your handle or DID.");

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

const password = process.env.ATPROTO_APP_PASSWORD;
if (!password) fail("set ATPROTO_APP_PASSWORD to an app password (not your account password).");

const session = await xrpc(pds, "com.atproto.server.createSession", {
	method: "POST",
	body: { identifier, password },
});

const created = await xrpc(pds, "com.atproto.repo.createRecord", {
	method: "POST",
	token: session.accessJwt,
	body: { repo: session.did, collection: COLLECTION, record },
});

console.log(`Created the Publication for ${siteUrl}:\n  ${created.uri}\n`);
console.log(
	"Next: set PUBLICATION_AT_URI in src/lib/site.mjs to that value and commit it.",
);
