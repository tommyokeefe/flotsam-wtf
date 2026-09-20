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
import { UserError, resolveDid, resolvePds, xrpc } from "./lib/atproto.mjs";

const COLLECTION = "site.standard.publication";

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

async function main() {
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
}

// The shared helpers throw `UserError` for anything expected, with a message that
// is safe to print; anything else is a bug and is left to surface as one.
try {
	await main();
} catch (error) {
	if (error instanceof UserError) fail(error.message);
	throw error;
}
