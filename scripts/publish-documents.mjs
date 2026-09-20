// Make the PDS match the built manifest: create a Document for each new Post,
// update the ones whose Post changed, and delete the ones whose Post is gone.
//
// This is only the execution half. Everything that decides *what* to write, and
// whether to write anything at all, is `planDocuments` (see there and ADR 0008);
// this reads the two sides, hands them over, and carries out the plan it gets
// back. If the planner refuses, nothing is written.
//
// Run it after a production-mode build:
//
//   npm run build
//   read -rs ATPROTO_APP_PASSWORD && export ATPROTO_APP_PASSWORD
//   npm run publish:documents
//
// It runs `audit:manifest` itself first and stops if a Draft is in the manifest,
// and it stops if a Post is newer than the manifest, so it can't publish a
// preview build or undo an edit with a stale one.
//
// `--dry-run` needs no password and no identifier. It reads the manifest and the
// PDS, prints the plan, and writes nothing, exactly as a real run would decide.
//
// `--max-deletions <n>` allows up to n deletions for this one run. The default
// is deliberately small (ADR 0008), so a larger clear-out is a flag someone has
// to type, and shows in the command that ran it.
//
// Publish from one place, which is CI. A Share image is recognised by the CID of
// its bytes, and the generated JPEG isn't guaranteed to be byte-identical across
// machines, so alternating between two would re-upload the cover each time. Runs
// must not overlap either (give the CI job a concurrency group): two racing
// creations leave two Documents for one path, which the planner refuses to guess
// between. If that happens, delete one of the two records by hand and re-run.
//
// Credentials come from the environment only, and are never printed or stored:
// `ATPROTO_APP_PASSWORD`, and optionally `ATPROTO_IDENTIFIER` (the Publication's
// own account is used when it is unset).
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { PUBLICATION_AT_URI } from "../src/lib/site.mjs";
import { UserError, parseAtUri, resolvePds, xrpc } from "./lib/atproto.mjs";
import { cidOfBytes } from "./lib/cid.mjs";
import { planDocuments } from "./plan-documents.mjs";

const DOCUMENT = "site.standard.document";
const PUBLICATION = "site.standard.publication";
// The Share image is always a generated JPEG (ADR 0006).
const COVER_TYPE = "image/jpeg";
// The lexicon caps a cover image at 1 MB. A PDS doesn't enforce a lexicon it
// doesn't know, but a reader that does would drop the record.
const MAX_COVER_BYTES = 1_000_000;
// What this tool writes, and so what an update replaces. Anything else already
// on a record (`tags`, `bskyPostRef`, whatever another tool has added) is kept:
// `putRecord` replaces the whole record, so an update built only from these
// would silently delete the rest.
const MANAGED_FIELDS = ["site", "title", "publishedAt", "path", "description", "coverImage"];

const root = resolve(import.meta.dirname, "..");
const distDir = join(root, "dist");

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

// The audit is the independent check that no Draft reached the manifest (ADR
// 0004), and it is a separate script on purpose, so it is run as one rather than
// imported. Running it here means no way of starting this skips it.
function auditManifest() {
	const audit = spawnSync(process.execPath, [join(root, "scripts", "audit-manifest.mjs")], {
		stdio: "inherit",
	});
	if (audit.status !== 0) throw new UserError("the manifest audit failed; not publishing.");
}

// The newest modification time of any file under `dir`.
function newestMtime(dir) {
	return Math.max(
		0,
		...readdirSync(dir, { recursive: true, withFileTypes: true })
			.filter((entry) => entry.isFile())
			.map((entry) => statSync(join(entry.parentPath, entry.name)).mtimeMs),
	);
}

// Only deletions are capped, so a manifest built before an edit would quietly
// put the old title back. A Post newer than the manifest means it is out of date.
function assertBuildIsFresh(manifestFile) {
	if (newestMtime(join(root, "src", "content", "posts")) > statSync(manifestFile).mtimeMs) {
		throw new UserError("a Post is newer than dist/posts.json, so the build is out of date. Run `npm run build` first.");
	}
}

// The site's manifest, with each Share image's identity added. The planner reads
// no files, so this is where an image's bytes become a CID, and where they are
// kept for the upload. An image that can't be read stops everything here, before
// anything is written: publishing the Post without its Share image would look
// like the image was removed to the planner and strip it from an existing
// Document.
function readManifest() {
	const manifestFile = join(distDir, "posts.json");
	let manifest;
	try {
		manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
	} catch (error) {
		throw new UserError(`couldn't read dist/posts.json — did the build run? (${error.message})`);
	}
	if (!Array.isArray(manifest)) throw new UserError("dist/posts.json isn't a list.");
	assertBuildIsFresh(manifestFile);

	const images = new Map();
	for (const entry of manifest) {
		if (typeof entry?.image !== "string") continue;

		let pathname;
		try {
			pathname = decodeURIComponent(new URL(entry.image).pathname);
		} catch {
			throw new UserError(`the Share image URL for ${entry.path} isn't usable: ${entry.image}`);
		}
		const file = resolve(distDir, `.${pathname}`);
		if (!file.startsWith(distDir + sep)) {
			throw new UserError(`${entry.image} points outside dist/; not reading it.`);
		}
		if (!/\.jpe?g$/i.test(file)) {
			throw new UserError(`${entry.image} isn't a JPEG (ADR 0006); not uploading it.`);
		}

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
		images.set(entry.imageCid, bytes);
	}
	return { manifest, images };
}

// Every Document the account holds. `documents` is in the shape the planner
// wants, with a stored cover flattened to its CID. `stored` keeps each record's
// full value and revision by `uri`, because an update has to preserve what the
// planner doesn't know about and say which revision it read. Pages through to
// the end: a list cut short would make published Posts look new, and they'd be
// created twice.
async function readDocuments(pds, did) {
	const documents = [];
	const stored = new Map();
	let cursor;
	do {
		const page = await xrpc(pds, "com.atproto.repo.listRecords", {
			params: { repo: did, collection: DOCUMENT, limit: "100", ...(cursor && { cursor }) },
		});
		for (const { uri, cid, value = {} } of page.records) {
			stored.set(uri, { value, cid });
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
	return { documents, stored };
}

// --- carrying out a plan ----------------------------------------------------

const describeChanges = (plan) => [
	...plan.creations.map((doc) => `  + create  ${doc.path}`),
	...plan.updates.map(({ document }) => `  ~ update  ${document.path}`),
	...plan.deletions.map(({ path }) => `  - delete  ${path}`),
];

// The rkey of a record, provided it is one of ours: in this account's repo, in
// the Document collection. Anything else is a bug, not a write.
function ourRkey(uri, did) {
	const parsed = parseAtUri(uri);
	if (parsed.did !== did || parsed.collection !== DOCUMENT) {
		throw new UserError(`${uri} isn't a ${DOCUMENT} in ${did}; refusing to write to it.`);
	}
	return parsed.rkey;
}

// Everything that could make a write fail for a reason knowable beforehand, done
// before the first one, so a bad record address or a missing image can't leave a
// run stopped half-way.
function validatePlan(plan, { did, images, stored }) {
	for (const { uri } of [...plan.updates, ...plan.deletions]) {
		ourRkey(uri, did);
		if (!stored.has(uri)) throw new UserError(`${uri} was planned but never read from the PDS.`);
	}
	for (const document of [...plan.creations, ...plan.updates.map((update) => update.document)]) {
		if (document.coverImage && !images.has(document.coverImage.cid)) {
			throw new UserError(`no image was read for ${document.path}'s cover (${document.coverImage.cid}).`);
		}
	}
}

// The blob for a planned cover image: the one the record already holds if it is
// the same image, and otherwise an upload. The PDS names a blob by its bytes, so
// the upload must come back with the CID worked out here. If it doesn't, the
// planner's comparison would never settle and the same Document would be
// rewritten on every run: stop before writing it.
async function coverBlob(document, current, { pds, token, images }) {
	const cover = document.coverImage;
	if (!cover) return undefined;
	if (current?.value.coverImage?.ref?.$link === cover.cid) return current.value.coverImage;

	const { blob } = await xrpc(pds, "com.atproto.repo.uploadBlob", {
		method: "POST",
		token,
		bytes: images.get(cover.cid),
		contentType: COVER_TYPE,
	});
	if (blob?.ref?.$link !== cover.cid) {
		throw new UserError(
			`the PDS stored ${cover.url} as ${blob?.ref?.$link}, not the ${cover.cid} worked out locally; not writing its Document.`,
		);
	}
	return blob;
}

// The record to store: everything already on it that this tool doesn't manage,
// then what it does. A managed field the plan leaves out (a description that was
// removed) is dropped, because it is not carried over from the old record.
function toRecord(document, blob, current) {
	const kept = Object.fromEntries(
		Object.entries(current?.value ?? {}).filter(([key]) => !MANAGED_FIELDS.includes(key)),
	);
	const { coverImage, ...fields } = document;
	return { ...kept, $type: DOCUMENT, ...fields, ...(blob && { coverImage: blob }) };
}

// Creations, then updates, then deletions: if a run stops part-way, it has left
// a Document where it should be rather than removed one that was still wanted.
// It stops at the first failure, and a re-run plans from what is now on the PDS.
// An update or deletion names the revision it read (`swapRecord`), so it fails
// rather than overwrite or delete a record that changed since.
async function carryOut(plan, { pds, did, token, images, stored }) {
	const done = { created: 0, updated: 0, deleted: 0 };
	const total = plan.creations.length + plan.updates.length + plan.deletions.length;
	const progress = (verb, path) =>
		console.log(`  ${verb} ${path}  (${done.created + done.updated + done.deleted}/${total})`);
	const context = { pds, token, images };

	for (const document of plan.creations) {
		const blob = await coverBlob(document, undefined, context);
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
		const current = stored.get(uri);
		const blob = await coverBlob(document, current, context);
		await xrpc(pds, "com.atproto.repo.putRecord", {
			method: "POST",
			token,
			body: {
				repo: did,
				collection: DOCUMENT,
				rkey: ourRkey(uri, did),
				record: toRecord(document, blob, current),
				swapRecord: current.cid,
			},
		});
		writes++;
		done.updated++;
		progress("updated", document.path);
	}
	for (const { uri, path } of plan.deletions) {
		await xrpc(pds, "com.atproto.repo.deleteRecord", {
			method: "POST",
			token,
			body: { repo: did, collection: DOCUMENT, rkey: ourRkey(uri, did), swapRecord: stored.get(uri).cid },
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

	auditManifest();
	const { manifest, images } = readManifest();
	const pds = await resolvePds(did);
	const { documents, stored } = await readDocuments(pds, did);

	const plan = planDocuments(manifest, documents, {
		publication: PUBLICATION_AT_URI,
		maxDeletions,
	});
	if (plan.refusal) {
		throw new UserError(`refusing to publish, and nothing was written: ${plan.refusal}`);
	}
	validatePlan(plan, { did, images, stored });

	const changes = describeChanges(plan);
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

	const done = await carryOut(plan, { pds, did, token: session.accessJwt, images, stored });
	console.log(`publish-documents: done. Created ${done.created}, updated ${done.updated}, deleted ${done.deleted}.`);
}

// The shared helpers throw `UserError` for anything expected, with a message that
// is safe to print; anything else is a bug and is left to surface as one. A
// failure after some writes says so, because the PDS is then partly updated and
// a re-run is the way to finish; a failure before any says nothing of the kind.
const partlyUpdated = () =>
	`${writes} write(s) had already happened, so the PDS is partly updated. A re-run plans from what is there now.`;
try {
	await main();
} catch (error) {
	if (error instanceof UserError) {
		fail(writes === 0 ? error.message : `${error.message}\n${partlyUpdated()}`);
	}
	if (writes > 0) console.error(`publish-documents: ${partlyUpdated()}`);
	throw error;
}
