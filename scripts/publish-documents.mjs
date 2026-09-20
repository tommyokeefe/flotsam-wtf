// Make the PDS match the built manifest: create a Document for each new Post,
// update the ones whose Post changed, and delete the ones whose Post is gone.
//
// This is only the execution half. Everything that decides *what* to write, and
// whether to write anything at all, is `planDocuments` (see there and ADR 0008);
// this reads the two sides, hands them over, and carries out the plan it gets
// back. If the planner refuses, nothing is written.
//
// Run after a production-mode build, so the manifest holds no Draft:
//
//   npm run build && npm run audit:manifest
//   read -rs ATPROTO_APP_PASSWORD && export ATPROTO_APP_PASSWORD
//   npm run publish:documents
//
// `--dry-run` needs no password and no identifier. It reads the manifest and the
// PDS, prints the plan, and writes nothing, exactly as a real run would decide.
//
// `--max-deletions <n>` allows up to n deletions for this one run. The default
// is deliberately small (ADR 0008), so a larger clear-out is a flag someone has
// to type, and shows in the command that ran it.
//
// Credentials come from the environment only, and are never printed or stored:
// `ATPROTO_APP_PASSWORD`, and optionally `ATPROTO_IDENTIFIER` (the Publication's
// own account is used when it is unset).
import { readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { PUBLICATION_AT_URI } from "../src/lib/site.mjs";
import { UserError, parseAtUri, resolvePds, xrpc } from "./lib/atproto.mjs";
import { cidOfBytes } from "./lib/cid.mjs";
import { planDocuments } from "./plan-documents.mjs";

const DOCUMENT = "site.standard.document";
const PUBLICATION = "site.standard.publication";
// The lexicon caps a cover image at 1 MB. A PDS doesn't enforce a lexicon it
// doesn't know, but a reader that does would drop the record.
const MAX_COVER_BYTES = 1_000_000;

const distDir = resolve(import.meta.dirname, "..", "dist");

// How many Documents have been written so far, so a failure can say whether the
// PDS was left partly updated or was never touched.
let writes = 0;

function fail(message) {
	console.error(`publish-documents: ${message}`);
	process.exit(1);
}

// --- arguments and environment, all checked before any network call ---------

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
let maxDeletions;
for (let i = 0; i < args.length; i++) {
	if (args[i] === "--dry-run") continue;
	if (args[i] === "--max-deletions") {
		const value = args[++i];
		if (!/^\d+$/.test(value ?? "")) fail("--max-deletions needs a whole number, 0 or more.");
		maxDeletions = Number(value);
		continue;
	}
	fail(`unknown argument ${args[i]}. Known: --dry-run, --max-deletions <n>.`);
}

if (!PUBLICATION_AT_URI) {
	fail("PUBLICATION_AT_URI in src/lib/site.mjs is not set. Run `npm run init:publication` first.");
}
const password = process.env.ATPROTO_APP_PASSWORD;
if (!dryRun && !password) {
	fail("set ATPROTO_APP_PASSWORD to an app password (not your account password).");
}

// --- reading the two sides --------------------------------------------------

// The site's manifest, with each Share image's identity added. The planner reads
// no files, so this is where an image's bytes become a CID, and where they are
// kept for the upload. An image that can't be read stops everything here, before
// anything is written: publishing the Post without its cover would look like
// "the cover was removed" to the planner and strip it from an existing Document.
function readManifest() {
	let manifest;
	try {
		manifest = JSON.parse(readFileSync(join(distDir, "posts.json"), "utf8"));
	} catch (error) {
		throw new UserError(`couldn't read dist/posts.json — did the build run? (${error.message})`);
	}
	if (!Array.isArray(manifest)) throw new UserError("dist/posts.json isn't a list.");

	const images = new Map();
	for (const entry of manifest) {
		if (typeof entry?.image !== "string") continue;

		const file = resolve(distDir, `.${decodeURIComponent(new URL(entry.image).pathname)}`);
		if (!file.startsWith(distDir + sep)) {
			throw new UserError(`${entry.image} points outside dist/; not reading it.`);
		}
		const mimeType = /\.jpe?g$/i.test(file) ? "image/jpeg" : null;
		if (!mimeType) throw new UserError(`${entry.image} isn't a JPEG (ADR 0006); not uploading it.`);

		let bytes;
		try {
			bytes = readFileSync(file);
		} catch (error) {
			throw new UserError(`couldn't read the Share image for ${entry.path} at ${file}: ${error.code ?? error.message}`);
		}
		if (bytes.length > MAX_COVER_BYTES) {
			throw new UserError(
				`the Share image for ${entry.path} is ${bytes.length} bytes, over the lexicon's ${MAX_COVER_BYTES} limit for a cover image.`,
			);
		}
		entry.imageCid = cidOfBytes(bytes);
		images.set(entry.imageCid, { bytes, mimeType });
	}
	return { manifest, images };
}

// Every Document the account holds, in the shape the planner wants. Pages
// through to the end: a list cut short would make published Posts look new, and
// they'd be created twice. A stored cover is flattened to its CID.
async function readDocuments(pds, did) {
	const documents = [];
	let cursor;
	do {
		const page = await xrpc(pds, "com.atproto.repo.listRecords", {
			params: { repo: did, collection: DOCUMENT, limit: "100", ...(cursor && { cursor }) },
		});
		for (const { uri, value = {} } of page.records) {
			documents.push({
				uri,
				site: value.site,
				title: value.title,
				path: value.path,
				publishedAt: value.publishedAt,
				description: value.description,
				coverImageCid: value.coverImage?.ref?.$link,
			});
		}
		cursor = page.cursor;
	} while (cursor);
	return documents;
}

// --- carrying out a plan ----------------------------------------------------

const describe = (plan) => [
	...plan.creations.map((doc) => `  + create  ${doc.path}`),
	...plan.updates.map(({ document }) => `  ~ update  ${document.path}`),
	...plan.deletions.map(({ path }) => `  - delete  ${path}`),
];

// The record as it is stored. `coverImage` in a plan is a `{ url, cid }` note to
// upload that file; here it is replaced by the blob the PDS hands back.
const toRecord = ({ coverImage, ...document }, blob) => ({
	$type: DOCUMENT,
	...document,
	...(blob && { coverImage: blob }),
});

// A record can only be addressed if it is one of ours: in this account's
// repo, in the Document collection. Anything else is a bug, not a write.
function rkeyOf(uri, did) {
	const parsed = parseAtUri(uri);
	if (parsed.did !== did || parsed.collection !== DOCUMENT) {
		throw new UserError(`${uri} isn't a ${DOCUMENT} in ${did}; refusing to write to it.`);
	}
	return parsed.rkey;
}

async function upload(pds, token, cover, images) {
	const image = images.get(cover.cid);
	const { blob } = await xrpc(pds, "com.atproto.repo.uploadBlob", {
		method: "POST",
		token,
		bytes: image.bytes,
		contentType: image.mimeType,
	});
	// The PDS names a blob by its bytes, so it must agree with the CID worked out
	// here. If it doesn't, the planner's comparison would never settle, and the
	// same Document would be rewritten on every run: stop before writing it.
	if (blob?.ref?.$link !== cover.cid) {
		throw new UserError(
			`the PDS stored ${cover.url} as ${blob?.ref?.$link}, not the ${cover.cid} worked out locally; not writing its Document.`,
		);
	}
	return blob;
}

// Creations, then updates, then deletions: if a run stops part-way, it has left
// a Document where it should be rather than removed one that was still wanted.
// It stops at the first failure, and a re-run plans from what is now on the PDS.
async function carryOut(plan, { pds, did, token, images }) {
	const done = { created: 0, updated: 0, deleted: 0 };
	const total = plan.creations.length + plan.updates.length + plan.deletions.length;
	const progress = (verb, path) =>
		console.log(`  ${verb} ${path}  (${done.created + done.updated + done.deleted}/${total})`);

	for (const document of plan.creations) {
		const blob = document.coverImage && (await upload(pds, token, document.coverImage, images));
		await xrpc(pds, "com.atproto.repo.createRecord", {
			method: "POST",
			token,
			body: { repo: did, collection: DOCUMENT, record: toRecord(document, blob) },
		});
		writes++;
		done.created++;
		progress("created", document.path);
	}
	for (const { uri, document } of plan.updates) {
		const rkey = rkeyOf(uri, did);
		const blob = document.coverImage && (await upload(pds, token, document.coverImage, images));
		await xrpc(pds, "com.atproto.repo.putRecord", {
			method: "POST",
			token,
			body: { repo: did, collection: DOCUMENT, rkey, record: toRecord(document, blob) },
		});
		writes++;
		done.updated++;
		progress("updated", document.path);
	}
	for (const { uri, path } of plan.deletions) {
		await xrpc(pds, "com.atproto.repo.deleteRecord", {
			method: "POST",
			token,
			body: { repo: did, collection: DOCUMENT, rkey: rkeyOf(uri, did) },
		});
		writes++;
		done.deleted++;
		progress("deleted", path);
	}
	return done;
}

async function main() {
	const publication = parseAtUri(PUBLICATION_AT_URI);
	if (publication.collection !== PUBLICATION) {
		throw new UserError(`PUBLICATION_AT_URI isn't a ${PUBLICATION}: ${PUBLICATION_AT_URI}`);
	}
	const did = publication.did;

	const { manifest, images } = readManifest();
	const pds = await resolvePds(did);
	const documents = await readDocuments(pds, did);

	const plan = planDocuments(manifest, documents, {
		publication: PUBLICATION_AT_URI,
		maxDeletions,
	});
	if (plan.refusal) fail(`refusing to publish, and nothing was written: ${plan.refusal}`);

	const changes = describe(plan);
	if (changes.length === 0) {
		console.log(`publish-documents: the PDS already matches the manifest (${manifest.length} Post(s)); nothing to write.`);
		return;
	}
	console.log(`publish-documents: ${changes.length} change(s) to ${did} on ${pds}:`);
	console.log(changes.join("\n"));
	if (dryRun) {
		console.log("dry run — nothing written.");
		return;
	}

	const session = await xrpc(pds, "com.atproto.server.createSession", {
		method: "POST",
		body: { identifier: process.env.ATPROTO_IDENTIFIER ?? did, password },
	});
	// Everything above was read from, and decided about, `did`. A session for any
	// other account would write somewhere the plan never looked.
	if (session.did !== did) {
		throw new UserError(`logged in as ${session.did}, but planned against ${did}; not writing.`);
	}

	const done = await carryOut(plan, { pds, did, token: session.accessJwt, images });
	console.log(`publish-documents: done. Created ${done.created}, updated ${done.updated}, deleted ${done.deleted}.`);
}

// The shared helpers throw `UserError` for anything expected, with a message that
// is safe to print; anything else is a bug and is left to surface as one. A
// failure after some writes says so, because the PDS is then partly updated and
// a re-run is the way to finish; a failure before any says nothing of the kind.
try {
	await main();
} catch (error) {
	if (error instanceof UserError) {
		fail(
			writes === 0
				? error.message
				: `${error.message}\n${writes} write(s) had already happened, so the PDS is partly updated. A re-run plans from what is there now.`,
		);
	}
	throw error;
}
